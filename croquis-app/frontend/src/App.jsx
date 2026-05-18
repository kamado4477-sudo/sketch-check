import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Rect, Group, Shape, Image as KonvaImage } from 'react-konva';
import { Pencil, Eraser, PenTool, Hand, Trash2, Search, Maximize, Grip, Send, X, Layers, Upload, Eye, EyeOff } from 'lucide-react';

// ==========================================
// ユーティリティ関数（色変換・筆圧計算）
// ==========================================

// HSVからHEXへの変換
function hsvToHex(h, s, v) { s /= 100; v /= 100; const k = (n) => (n + h / 60) % 6; const f = (n) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1)); const toHex = (x) => { const hex = Math.round(x * 255).toString(16); return hex.length === 1 ? '0' + hex : hex; }; return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`; }

// HEXからRGBAへの変換（不透明度対応）
const hexToRgba = (hex, alpha) => {
  if (!hex) return `rgba(223,75,38,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

// HEXからHSVへの変換
const hexToHsv = (hex) => {
  if (!hex) return { h: 0, s: 0, v: 0 };
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, v = max;
  let d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), v: Math.round(v * 100) };
};

// Apple Pencil等の筆圧（pressure）から実際の線の太さを計算
const getStrokeWidth = (pressure, baseWidth) => {
  if (pressure >= 1.0) return baseWidth; 
  const normalizedP = Math.min(1.0, pressure * 1.33); 
  const scale = 0.1 + 0.9 * Math.pow(normalizedP, 1.2);
  return scale * baseWidth;
};

// グローバルなUIスタイル設定
const uiStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@600;800&family=M+PLUS+Rounded+1c:wght@500;700&display=swap');
  
  .modern-ui {
    font-family: 'Nunito', 'M PLUS Rounded 1c', sans-serif;
  }
  
  .tool-btn {
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .tool-btn:active {
    transform: scale(0.92);
  }
  
  .modern-slider {
    -webkit-appearance: slider-vertical;
    width: 24px;
    height: 100%;
    accent-color: #df4b26;
    cursor: pointer;
  }
`;

// ==========================================
// コンポーネント: カスタムカラーピッカー
// iPadでのタッチ操作に最適化（ドラッグ時の排他制御など）
// ==========================================
const CustomColorPicker = ({ color, onChange }) => {
  const [hsv, setHsv] = useState(() => hexToHsv(color || '#df4b26')); 
  const ringRef = useRef(null); const boxRef = useRef(null);
  const isDraggingHue = useRef(false); const isDraggingSV = useRef(false);

  useEffect(() => {
    if (!isDraggingHue.current && !isDraggingSV.current) {
      setHsv(hexToHsv(color || '#df4b26'));
    }
  }, [color]);

  const updateColor = (newHsv) => { setHsv(newHsv); onChange(hsvToHex(newHsv.h, newHsv.s, newHsv.v)); };

  const handlePointerDown = (e, type) => {
    e.stopPropagation();
    
    if (type === 'hue') {
      const rect = ringRef.current.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width/2);
      const dy = e.clientY - (rect.top + rect.height/2);
      const distance = Math.hypot(dx, dy);
      
      // リングの内側（透明部分）の誤タップを防止するバリア判定
      if (distance < 56) return;

      try { e.target.setPointerCapture(e.pointerId); } catch(err){}
      isDraggingHue.current = true;
      isDraggingSV.current = false; // 排他制御：同時に操作させない
      handleMove(e, 'hue');
    } else {
      try { e.target.setPointerCapture(e.pointerId); } catch(err){}
      isDraggingSV.current = true;
      isDraggingHue.current = false; 
      handleMove(e, 'sv');
    }
  };

  const handlePointerMove = (e, type) => {
    if (type === 'hue' && isDraggingHue.current) handleMove(e, 'hue');
    if (type === 'sv' && isDraggingSV.current) handleMove(e, 'sv');
  };

  const handlePointerUp = (e, type) => {
    e.stopPropagation();
    try { e.target.releasePointerCapture(e.pointerId); } catch(err){}
    if (type === 'hue') isDraggingHue.current = false;
    if (type === 'sv') isDraggingSV.current = false;
  };

  const handleMove = (e, type) => {
    const ref = type === 'hue' ? ringRef : boxRef; 
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    
    // 角度（Hue）または座標（Saturation/Value）から色を計算
    if (type === 'hue') {
      const angle = Math.atan2(e.clientY - (rect.top + rect.height/2), e.clientX - (rect.left + rect.width/2)) * (180 / Math.PI);
      updateColor({ ...hsv, h: angle < 0 ? angle + 360 : angle });
    } else {
      updateColor({ 
        ...hsv, 
        s: Math.max(0, Math.min((e.clientX - rect.left) / rect.width * 100, 100)), 
        v: Math.max(0, Math.min(100 - (e.clientY - rect.top) / rect.height * 100, 100)) 
      });
    }
  };

  const hueRadius = 68; const hueX = 80 + hueRadius * Math.cos(hsv.h * Math.PI / 180); const hueY = 80 + hueRadius * Math.sin(hsv.h * Math.PI / 180);
  const sliderStyles = `
    .custom-slider { -webkit-appearance: none; width: 100%; height: 8px; border-radius: 4px; outline: none; }
    .custom-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 24px; height: 24px; border-radius: 50%; background: #fff; cursor: pointer; border: 2px solid #ccc; box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
    .custom-slider::-moz-range-thumb { width: 24px; height: 24px; border-radius: 50%; background: #fff; cursor: pointer; border: 2px solid #ccc; box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
  `;
  return (
    <div className="modern-ui" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '220px', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
      <style>{sliderStyles}</style>
      <div style={{ position: 'relative', width: 160, height: 160, userSelect: 'none', touchAction: 'none' }}>
        {/* カラーリング（Hue） */}
        <div 
          ref={ringRef} 
          onPointerDown={(e) => handlePointerDown(e, 'hue')} 
          onPointerMove={(e) => handlePointerMove(e, 'hue')} 
          onPointerUp={(e) => handlePointerUp(e, 'hue')} 
          style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', background: 'conic-gradient(from 90deg, red, yellow, lime, cyan, blue, magenta, red)', maskImage: 'radial-gradient(transparent 56px, black 57px)', WebkitMaskImage: 'radial-gradient(transparent 56px, black 57px)' }} 
        />
        <div style={{ position: 'absolute', left: hueX, top: hueY, width: 16, height: 16, borderRadius: '50%', backgroundColor: 'white', border: '2px solid #333', transform: 'translate(-50%, -50%)', pointerEvents: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }} />
        
        {/* カラーボックス（Saturation/Value） */}
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 80, height: 80, borderRadius: 4, backgroundColor: `hsl(${hsv.h}, 100%, 50%)`, overflow: 'hidden', boxShadow: 'inset 0 0 4px rgba(0,0,0,0.2)' }}>
          <div style={{ position: 'absolute', width: '100%', height: '100%', background: 'linear-gradient(to right, #fff, transparent), linear-gradient(to bottom, transparent, #000)' }} />
          <div 
            ref={boxRef} 
            onPointerDown={(e) => handlePointerDown(e, 'sv')} 
            onPointerMove={(e) => handlePointerMove(e, 'sv')} 
            onPointerUp={(e) => handlePointerUp(e, 'sv')} 
            style={{ position: 'absolute', width: '100%', height: '100%' }} 
          />
          <div style={{ position: 'absolute', left: `${hsv.s}%`, top: `${100 - hsv.v}%`, width: 14, height: 14, borderRadius: '50%', border: '2px white solid', transform: 'translate(-50%, -50%)', pointerEvents: 'none', boxShadow: '0 0 4px rgba(0,0,0,0.6)' }} />
        </div>
      </div>
      
      {/* HSVスライダー */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '20px', width: '100%' }}>
        {['h', 's', 'v'].map(k => {
          let bgGradient = '#ddd';
          if (k === 'h') bgGradient = 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)';
          if (k === 's') bgGradient = `linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`;
          if (k === 'v') bgGradient = `linear-gradient(to right, #000, hsl(${hsv.h}, 100%, 50%))`;
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: '800', width: '12px', color: '#888', textAlign: 'center' }}>{k.toUpperCase()}</span>
              <input type="range" className="custom-slider" min="0" max={k === 'h' ? 360 : 100} value={Math.round(hsv[k])} onChange={e => updateColor({...hsv, [k]: parseInt(e.target.value)})} style={{ background: bgGradient, border: '1px solid #eee' }} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ==========================================
// 描画ロジック：ベジェ曲線と筆圧を考慮したレンダリング
// ==========================================
const renderLinesToContext = (context, lineArray) => {
  lineArray.forEach(line => {
    const pts = line.points;
    if (!pts || pts.length === 0) return;
    const width = line.width;
    const isEraser = line.tool === 'eraser';
    
    const lineOpacity = line.opacity !== undefined ? line.opacity / 100 : 1;
    const colorStr = isEraser ? `rgba(255,255,255,${lineOpacity})` : hexToRgba(line.color, lineOpacity);

    context.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = colorStr;
    context.fillStyle = colorStr;

    // 点（クリックのみ）の場合
    if (pts.length === 1) {
      context.beginPath();
      context.arc(pts[0].x, pts[0].y, getStrokeWidth(pts[0].p, width) / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    
    // 直線（2点）の場合
    if (pts.length === 2) {
      context.beginPath();
      context.moveTo(pts[0].x, pts[0].y);
      context.lineTo(pts[1].x, pts[1].y);
      context.lineWidth = getStrokeWidth((pts[0].p + pts[1].p) / 2, width);
      context.stroke();
      return;
    }

    // 滑らかな曲線（Quadratic Curve）での描画
    context.beginPath();
    context.moveTo(pts[0].x, pts[0].y);
    const firstMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    context.lineTo(firstMid.x, firstMid.y);
    context.lineWidth = getStrokeWidth(pts[0].p, width);
    context.stroke();

    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      
      const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      
      context.beginPath();
      context.moveTo(mid1.x, mid1.y);
      context.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
      context.lineWidth = getStrokeWidth(p1.p, width);
      context.stroke();
    }

    const pLast = pts[pts.length - 1];
    const pPrev = pts[pts.length - 2];
    const lastMid = { x: (pPrev.x + pLast.x) / 2, y: (pPrev.y + pLast.y) / 2 };
    
    context.beginPath();
    context.moveTo(lastMid.x, lastMid.y);
    context.lineTo(pLast.x, pLast.y);
    context.lineWidth = getStrokeWidth(pLast.p, width);
    context.stroke();
  });
};

// ==========================================
// メインアプリケーション
// ==========================================
function App() {
  // レイヤーと描画データの状態
  const [lines, setLines] = useState([]); 
  const [activeLayer, setActiveLayer] = useState(0); 
  const [showLayerMenu, setShowLayerMenu] = useState(false); 
  const [layerSettings, setLayerSettings] = useState([
    { visible: true, opacity: 1 }, 
    { visible: true, opacity: 1 }  
  ]);

  // ツールの状態
  const [tool, setTool] = useState('pen'); 
  const [refImage, setRefImage] = useState(null); 
  const [refDims, setRefDims] = useState(null); 
  const [uploadedSketch, setUploadedSketch] = useState(null);
  const [pencilOnly, setPencilOnly] = useState(true);
  
  // ペン・消しゴムの設定
  const [penWidth, setPenWidth] = useState(10); 
  const [eraserWidth, setEraserWidth] = useState(20);
  const [penOpacity, setPenOpacity] = useState(100); 
  const [eraserOpacity, setEraserOpacity] = useState(100); 
  
  // カラーパレットの状態
  const [penColor, setPenColor] = useState('#df4b26');
  const [colorHistory, setColorHistory] = useState(['#df4b26', '#1e1e1e', '#4b5563', '#9ca3af', '#e5e7eb']); 
  const [showColorPicker, setShowColorPicker] = useState(false);
  
  // 評価（API連携）の状態
  const [isEvaluating, setIsEvaluating] = useState(false); 
  const [evaluationResult, setEvaluationResult] = useState(null); 
  
  // キャンバス・ビューポートの状態
  const [baseSize, setBaseSize] = useState({ width: 595, height: 842 }); // 初期値はA4比率
  const mainAreaRef = useRef(null);
  const stageRef = useRef(null);
  const [stageSize, setStageSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [baseScale, setBaseScale] = useState(1); 
  const [userTransform, setUserTransform] = useState({ x: 0, y: 0, scale: 1, rotation: 0 });
  const [isTransforming, setIsTransforming] = useState(false);
  
  // ポインター・ジェスチャー管理用のRef（再レンダリング防止用）
  const activePointers = useRef(new Map()); 
  const initialGesture = useRef(null);
  const isDrawing = useRef(false); 
  const currentPoints = useRef([]);
  
  // 描画最適化用のCanvas
  const activeCanvasRef = useRef(document.createElement('canvas'));
  const [activeCtx, setActiveCtx] = useState(null);
  const activeDrawingLayerRef = useRef(null);
  const drawingLayerRefs = useRef([]); 
  const sketchInputRef = useRef(null);
  
  // フローティングウィンドウ（お手本画像）の状態
  const [winPos, setWinPos] = useState({ x: 20, y: 20 }); 
  const [winSize, setWinSize] = useState({ width: 280, height: 350 });
  const [refTransform, setRefTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isDraggingWin = useRef(false); const isResizingWin = useRef(false); const dragOffset = useRef({ x: 0, y: 0 });
  const refPointers = useRef(new Map()); const refGesture = useRef(null);

  // パフォーマンス最適化：レイヤーごとの描画データをメモ化
  const linesLayer0 = useMemo(() => lines.filter(l => l.layer === 0), [lines]);
  const linesLayer1 = useMemo(() => lines.filter(l => l.layer === 1), [lines]);

  // ウィンドウリサイズ・初期化処理
  useEffect(() => {
    const handleResize = () => {
      if (!mainAreaRef.current) return;
      const w = mainAreaRef.current.clientWidth; 
      const h = mainAreaRef.current.clientHeight;
      setStageSize({ width: w, height: h });
      setBaseScale(Math.min((w - 40) / baseSize.width, (h - 40) / baseSize.height));
    };
    handleResize();
    
    if (activeCanvasRef.current) {
      const ratio = window.devicePixelRatio || 2; 
      activeCanvasRef.current.width = baseSize.width * ratio;
      activeCanvasRef.current.height = baseSize.height * ratio;
      
      const ctx = activeCanvasRef.current.getContext('2d');
      ctx.scale(ratio, ratio);
      setActiveCtx(ctx);
    }

    window.addEventListener('resize', handleResize);
    // iOS/iPadOS特有のジェスチャーによる誤動作を防止
    const preventNative = (e) => { e.preventDefault(); };
    document.addEventListener('gesturestart', preventNative);
    return () => { 
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('gesturestart', preventNative);
    };
  }, [baseSize]);

  // カラーヒストリーの更新
  useEffect(() => {
    if (!showColorPicker) {
      setColorHistory(prev => {
        if (prev[0] === penColor) return prev;
        const newHist = prev.filter(c => c !== penColor);
        newHist.unshift(penColor);
        return newHist.slice(0, 5); 
      });
    }
  }, [showColorPicker, penColor]);

  // 現在のアクティブレイヤーをクリア
  const handleClearLayer = () => {
    setLines(prevLines => prevLines.filter(line => line.layer !== activeLayer));
    isDrawing.current = false;
    currentPoints.current = [];
    if (activeCtx) {
      activeCtx.clearRect(0, 0, baseSize.width, baseSize.height);
    }
    if (activeDrawingLayerRef.current) activeDrawingLayerRef.current.batchDraw();
  };

  // ==========================================
  // API連携：バックエンド（YOLO/OpenCV）への画像送信
  // ==========================================
  const handleEvaluate = async () => {
    if (isEvaluating) return;
    setIsEvaluating(true);

    // 送信前に描画状態をリセット
    activePointers.current.clear();
    setIsTransforming(false);
    initialGesture.current = null;
    isDrawing.current = false;
    currentPoints.current = [];
    drawingLayerRefs.current.forEach(layer => { if (layer) layer.batchDraw(); });
    if (activeCtx) activeCtx.clearRect(0, 0, baseSize.width, baseSize.height);
    if (activeDrawingLayerRef.current) activeDrawingLayerRef.current.batchDraw();

    try {
      let sketchBlob;
      if (uploadedSketch) {
        sketchBlob = await (await fetch(uploadedSketch)).blob();
      } else {
        // キャンバスのスクロール状態を一時的にリセットして画像化
        const tempTransform = { ...userTransform };
        setUserTransform({ x: 0, y: 0, scale: 1, rotation: 0 });
        await new Promise(r => setTimeout(r, 100));
        
        const dataURL = stageRef.current.toDataURL({ 
          x: stageSize.width / 2 - baseSize.width / 2,
          y: stageSize.height / 2 - baseSize.height / 2,
          width: baseSize.width,
          height: baseSize.height,
          pixelRatio: 1 
        });
        setUserTransform(tempTransform);
        sketchBlob = await (await fetch(dataURL)).blob();
      }

      const formData = new FormData();
      formData.append("sketch", sketchBlob, "sketch.png");
      if (refImage) formData.append("reference", await (await fetch(refImage)).blob(), "reference.png");
      
      // 【重要】環境変数からAPI_URLを取得（設定がない場合はローカルIPにフォールバック）
      const apiUrl = import.meta.env.VITE_API_URL || "http://192.168.1.113:8000/api/evaluate";
      
      const response = await fetch(apiUrl, { method: "POST", body: formData });
      const result = await response.json();
      if (result.status === "success") setEvaluationResult(result);
      else alert("評価失敗: " + result.message);
    } catch (e) { alert("通信エラー"); }
    setIsEvaluating(false);
  };

  // ==========================================
  // キャンバスのポインターイベント制御（描画・パン・ズーム）
  // ==========================================
  const handlePointerDown = (e) => {
    if (showColorPicker) setShowColorPicker(false);
    if (showLayerMenu) setShowLayerMenu(false); 

    const evt = e.evt; 
    activePointers.current.set(evt.pointerId, { pointerId: evt.pointerId, clientX: evt.clientX, clientY: evt.clientY, pointerType: evt.pointerType });
    const pts = Array.from(activePointers.current.values());
    const touches = pts.filter(p => p.pointerType === 'touch');
    const pens = pts.filter(p => p.pointerType === 'pen' || p.pointerType === 'mouse');
    
    // 2本指タッチ：キャンバスの移動・ズーム（トランスフォーム開始）
    if (touches.length === 2 && pens.length === 0) {
      isDrawing.current = false; 
      setIsTransforming(true);

      currentPoints.current = [];
      if (activeCtx) {
        activeCtx.clearRect(0, 0, baseSize.width, baseSize.height);
      }
      if (activeDrawingLayerRef.current) activeDrawingLayerRef.current.batchDraw();

      const p1 = touches[0], p2 = touches[1];
      const dist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
      if (dist > 0) {
        initialGesture.current = { dist: dist, angle: Math.atan2(p2.clientY - p1.clientY, p2.clientX - p1.clientX), cx: (p1.clientX + p2.clientX) / 2, cy: (p1.clientY + p2.clientY) / 2, scale: userTransform.scale, rotation: userTransform.rotation, x: userTransform.x, y: userTransform.y };
      }
      return;
    }
    
    const isPen = evt.pointerType === 'pen' || evt.pointerType === 'mouse';
    if (!layerSettings[activeLayer].visible) return;

    // ペン入力、または設定による指入力の許可判定
    if ((pens.length === 1 && isPen) || (!pencilOnly && touches.length === 1 && pens.length === 0)) {
      isDrawing.current = true;
      
      const stage = stageRef.current;
      const rect = stage.container().getBoundingClientRect();
      const stageX = evt.clientX - rect.left;
      const stageY = evt.clientY - rect.top;

      const groupNode = stage.findOne('.paper-group');
      const pt = groupNode.getAbsoluteTransform().copy().invert().point({ x: stageX, y: stageY });
      const pressure = evt.pointerType === 'pen' ? (evt.pressure || 0.1) : 1.0;
      
      currentPoints.current = [{ x: pt.x, y: pt.y, p: pressure }];
      
      if (isPen) {
        if (activeCtx) {
          const isEraser = tool === 'eraser';
          const width = isEraser ? eraserWidth : penWidth;
          const opacity = (isEraser ? eraserOpacity : penOpacity) / 100;
          
          activeCtx.lineCap = 'round';
          activeCtx.lineJoin = 'round';
          activeCtx.globalCompositeOperation = 'source-over';
          activeCtx.fillStyle = isEraser ? `rgba(255,255,255,${opacity})` : hexToRgba(penColor, opacity);
          
          activeCtx.beginPath();
          activeCtx.arc(pt.x, pt.y, getStrokeWidth(pressure, width) / 2, 0, Math.PI * 2);
          activeCtx.fill();
          
          if (activeDrawingLayerRef.current) activeDrawingLayerRef.current.batchDraw();
        }
      }
    }
  };

  const handleRootPointerMove = (e) => {
    // 描画または操作中はデフォルトのスクロールなどを防ぐ
    if (isDrawing.current || isTransforming) {
      if (e.cancelable) e.preventDefault();
    }

    if (activePointers.current.has(e.pointerId)) {
      activePointers.current.set(e.pointerId, { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType });
    }
    
    const touches = Array.from(activePointers.current.values()).filter(p => p.pointerType === 'touch');
    
    // トランスフォーム処理（パン・ズーム・回転）
    if (isTransforming && touches.length === 2 && initialGesture.current) {
      const p1 = touches[0], p2 = touches[1], dist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
      const angle = Math.atan2(p2.clientY - p1.clientY, p2.clientX - p1.clientX), cx = (p1.clientX + p2.clientX) / 2, cy = (p1.clientY + p2.clientY) / 2;
      let rot = initialGesture.current.rotation + (angle - initialGesture.current.angle) * (180 / Math.PI);
      const snap = Math.round(rot / 90) * 90; if (Math.abs(rot - snap) < 5) rot = snap;
      setUserTransform({ scale: Math.max(0.2, Math.min(initialGesture.current.scale * (dist / initialGesture.current.dist), 5)), rotation: rot, x: initialGesture.current.x + (cx - initialGesture.current.cx), y: initialGesture.current.y + (cy - initialGesture.current.cy) });
      return;
    }
    
    // 描画処理（最適化のため、Native Canvas 2D Contextへ直接描画）
    if (isDrawing.current) {
      const stage = stageRef.current;
      if (!stage) return;
      
      const rect = stage.container().getBoundingClientRect();
      const stageX = e.clientX - rect.left;
      const stageY = e.clientY - rect.top;

      const groupNode = stage.findOne('.paper-group');
      const pt = groupNode.getAbsoluteTransform().copy().invert().point({ x: stageX, y: stageY });
      const pressure = e.pointerType === 'pen' ? (e.pressure || 0.1) : 1.0;
      
      const pts = currentPoints.current;
      if (pts.length > 0) {
        const lastPt = pts[pts.length - 1];
        const dist = Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y);
        
        if (dist < 3.0) return; // 負荷軽減：近すぎる点は無視
        
        if (activeCtx) {
          const isEraser = tool === 'eraser';
          const width = isEraser ? eraserWidth : penWidth;
          const opacity = (isEraser ? eraserOpacity : penOpacity) / 100;
          
          activeCtx.strokeStyle = isEraser ? `rgba(255,255,255,${opacity})` : hexToRgba(penColor, opacity);
          activeCtx.globalCompositeOperation = 'source-over';
          
          // 滑らかなベジェ曲線（Quadratic Curve）での描画補間
          if (pts.length >= 2) {
            const p0 = pts[pts.length - 2];
            const p1 = lastPt; 
            const p2 = pt;

            const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
            const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

            activeCtx.beginPath();
            activeCtx.moveTo(mid1.x, mid1.y);
            activeCtx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
            activeCtx.lineWidth = getStrokeWidth(p1.p, width);
            activeCtx.stroke();
          } else {
            const p0 = lastPt;
            const p1 = pt;
            const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
            
            activeCtx.beginPath();
            activeCtx.moveTo(p0.x, p0.y);
            activeCtx.lineTo(mid.x, mid.y);
            activeCtx.lineWidth = getStrokeWidth(p0.p, width);
            activeCtx.stroke();
          }
          
          if (activeDrawingLayerRef.current) activeDrawingLayerRef.current.batchDraw(); 
        }
      }
      pts.push({ x: pt.x, y: pt.y, p: pressure });
    }
  };

  const handleRootPointerUp = (e) => {
    activePointers.current.delete(e.pointerId);
    
    if (isTransforming && Array.from(activePointers.current.values()).filter(p => p.pointerType === 'touch').length < 2) { 
      setIsTransforming(false); 
      initialGesture.current = null; 
    }
    
    // 描画終了時に、蓄積したパスデータをReactのState（lines配列）に保存
    if (isDrawing.current && (e.pointerType === 'pen' || e.pointerType === 'mouse' || (!pencilOnly && activePointers.current.size === 0))) {
      isDrawing.current = false;
      
      if (currentPoints.current.length > 0) {
        setLines([...lines, { 
          points: [...currentPoints.current], 
          tool, 
          width: tool === 'eraser' ? eraserWidth : penWidth, 
          color: tool === 'eraser' ? null : penColor, 
          opacity: tool === 'eraser' ? eraserOpacity : penOpacity, 
          layer: activeLayer 
        }]);
      }
      
      currentPoints.current = [];
      
      if (activeCtx) {
        activeCtx.clearRect(0, 0, baseSize.width, baseSize.height);
      }
      if (activeDrawingLayerRef.current) activeDrawingLayerRef.current.batchDraw();
    }
  };

  const btnStyle = (active) => ({ 
    width: 60, 
    height: 60, 
    borderRadius: 16, 
    border: 'none', 
    cursor: 'pointer', 
    display: 'flex', 
    flexDirection: 'column', 
    justifyContent: 'center', 
    alignItems: 'center', 
    gap: 4, 
    backgroundColor: active ? '#df4b26' : '#f4f5f7', 
    color: active ? 'white' : '#6b7280', 
    boxShadow: active ? '0 4px 12px rgba(223, 75, 38, 0.3)' : 'none'
  });

  const isDefaultRatio = baseSize.width === 595 && baseSize.height === 842;

  // ==========================================
  // レンダリング (UI構成)
  // ==========================================
  return (
    <div 
      className="modern-ui" 
      style={{ display: 'flex', width: '100vw', height: '100dvh', overflow: 'hidden', backgroundColor: '#ebecf0', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'none' }}
      onPointerMove={handleRootPointerMove}
      onPointerUp={handleRootPointerUp}
      onPointerCancel={handleRootPointerUp}
      onPointerLeave={handleRootPointerUp}
    >
      <style>{uiStyles}</style>
      
      {/* 描画エリア (Konva Stage) */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }} ref={mainAreaRef}>
        <button className="tool-btn" style={{ position: 'absolute', bottom: 24, right: 24, backgroundColor: 'rgba(255,255,255,0.9)', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', borderRadius: '50%', width: 56, height: 56, zIndex: 5, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#6b7280' }} onClick={() => setUserTransform({ x: 0, y: 0, scale: 1, rotation: 0 })}><Maximize size={24} /></button>
        
        <Stage 
          width={stageSize.width} 
          height={stageSize.height} 
          onPointerDown={handlePointerDown} 
          ref={stageRef}
        >
          {/* キャンバス背景 */}
          <Layer>
            <Group name="paper-group" offsetX={baseSize.width/2} offsetY={baseSize.height/2} x={stageSize.width/2 + userTransform.x} y={stageSize.height/2 + userTransform.y} scaleX={baseScale * userTransform.scale} scaleY={baseScale * userTransform.scale} rotation={userTransform.rotation}>
              <Rect width={baseSize.width} height={baseSize.height} fill="white" shadowBlur={15} shadowColor="rgba(0,0,0,0.08)" />
            </Group>
          </Layer>
          
          {/* レイヤー1 (奥) */}
          <Layer ref={el => drawingLayerRefs.current[1] = el} visible={layerSettings[1].visible} opacity={layerSettings[1].opacity}>
            <Group name="paper-group" offsetX={baseSize.width/2} offsetY={baseSize.height/2} x={stageSize.width/2 + userTransform.x} y={stageSize.height/2 + userTransform.y} scaleX={baseScale * userTransform.scale} scaleY={baseScale * userTransform.scale} rotation={userTransform.rotation} clipWidth={baseSize.width} clipHeight={baseSize.height}>
              <Shape perfectDrawEnabled={false} shadowForStrokeEnabled={false} hitStrokeWidth={0} listening={false} sceneFunc={(ctx) => renderLinesToContext(ctx, linesLayer1)} />
            </Group>
          </Layer>

          {activeLayer === 1 && (
            <Layer ref={activeDrawingLayerRef} visible={layerSettings[1].visible} opacity={layerSettings[1].opacity} listening={false}>
              <Group name="paper-group" offsetX={baseSize.width/2} offsetY={baseSize.height/2} x={stageSize.width/2 + userTransform.x} y={stageSize.height/2 + userTransform.y} scaleX={baseScale * userTransform.scale} scaleY={baseScale * userTransform.scale} rotation={userTransform.rotation} clipWidth={baseSize.width} clipHeight={baseSize.height}>
                <Shape 
                  perfectDrawEnabled={false} 
                  shadowForStrokeEnabled={false} 
                  hitStrokeWidth={0} 
                  listening={false} 
                  sceneFunc={(ctx) => {
                    if (activeCanvasRef.current) {
                      ctx.drawImage(activeCanvasRef.current, 0, 0, baseSize.width, baseSize.height);
                    }
                  }} 
                />
              </Group>
            </Layer>
          )}
          
          {/* レイヤー0 (手前) */}
          <Layer ref={el => drawingLayerRefs.current[0] = el} visible={layerSettings[0].visible} opacity={layerSettings[0].opacity}>
            <Group name="paper-group" offsetX={baseSize.width/2} offsetY={baseSize.height/2} x={stageSize.width/2 + userTransform.x} y={stageSize.height/2 + userTransform.y} scaleX={baseScale * userTransform.scale} scaleY={baseScale * userTransform.scale} rotation={userTransform.rotation} clipWidth={baseSize.width} clipHeight={baseSize.height}>
              <Shape perfectDrawEnabled={false} shadowForStrokeEnabled={false} hitStrokeWidth={0} listening={false} sceneFunc={(ctx) => renderLinesToContext(ctx, linesLayer0)} />
            </Group>
          </Layer>

          {activeLayer === 0 && (
            <Layer ref={activeDrawingLayerRef} visible={layerSettings[0].visible} opacity={layerSettings[0].opacity} listening={false}>
              <Group name="paper-group" offsetX={baseSize.width/2} offsetY={baseSize.height/2} x={stageSize.width/2 + userTransform.x} y={stageSize.height/2 + userTransform.y} scaleX={baseScale * userTransform.scale} scaleY={baseScale * userTransform.scale} rotation={userTransform.rotation} clipWidth={baseSize.width} clipHeight={baseSize.height}>
                <Shape 
                  perfectDrawEnabled={false} 
                  shadowForStrokeEnabled={false} 
                  hitStrokeWidth={0} 
                  listening={false} 
                  sceneFunc={(ctx) => {
                    if (activeCanvasRef.current) {
                      ctx.drawImage(activeCanvasRef.current, 0, 0, baseSize.width, baseSize.height);
                    }
                  }} 
                />
              </Group>
            </Layer>
          )}
        </Stage>

        {/* お手本画像 (フローティングウィンドウ) */}
        <div style={{ position: 'absolute', top: winPos.y, left: winPos.x, width: winSize.width, height: winSize.height, backgroundColor: 'white', borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid #f3f4f6' }}>
          <div style={{ display: 'flex', backgroundColor: '#f9fafb', borderBottom: '1px solid #f3f4f6', alignItems: 'center', padding: '10px 14px', touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); isDraggingWin.current = true; dragOffset.current = { x: e.clientX - winPos.x, y: e.clientY - winPos.y }; }} onPointerMove={e => { if (isDraggingWin.current) setWinPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y }); }} onPointerUp={e => { isDraggingWin.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={e => { isDraggingWin.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}>
            <span style={{ fontSize: 13, fontWeight: '800', display: 'flex', alignItems: 'center', gap: 6, color: '#4b5563' }}><Search size={16} /> お手本</span>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              {refImage && refDims && (
                <button
                  className="tool-btn"
                  onClick={() => {
                    if (isDefaultRatio) {
                      const ratio = refDims.w / refDims.h;
                      if (ratio > 1) {
                        setBaseSize({ width: 842, height: Math.round(842 / ratio) });
                      } else {
                        setBaseSize({ width: Math.round(842 * ratio), height: 842 });
                      }
                    } else {
                      setBaseSize({ width: 595, height: 842 });
                    }
                  }}
                  style={{ cursor: 'pointer', padding: '6px 10px', backgroundColor: isDefaultRatio ? '#f3f4f6' : '#4b5563', color: isDefaultRatio ? '#4b5563' : '#fff', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: '800' }}
                >
                  {isDefaultRatio ? '比率を合わせる' : 'A4に戻す'}
                </button>
              )}
              <label className="tool-btn" style={{ cursor: 'pointer', padding: '6px 10px', backgroundColor: '#df4b26', color: 'white', borderRadius: 8, fontSize: 11, fontWeight: '800' }}>
                画像選択
                <input type="file" accept="image/*" onChange={e => { 
                  const f = e.target.files[0]; 
                  if (f) { 
                    const r = new FileReader(); 
                    r.onload = (ev) => {
                      setRefImage(ev.target.result); 
                      const img = new window.Image();
                      img.onload = () => setRefDims({ w: img.width, h: img.height });
                      img.src = ev.target.result;
                    };
                    r.readAsDataURL(f); 
                  } 
                }} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', backgroundColor: '#f3f4f6', position: 'relative', touchAction: 'none' }} onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); refPointers.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY }); if (refPointers.current.size === 2) { const pts = Array.from(refPointers.current.values()); refGesture.current = { type: 'zoom', dist: Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY), scale: refTransform.scale }; } else { refGesture.current = { type: 'pan', startX: e.clientX, startY: e.clientY, originX: refTransform.x, originY: refTransform.y }; } }} onPointerMove={e => { if (!refPointers.current.has(e.pointerId)) return; refPointers.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY }); if (refPointers.current.size === 2 && refGesture.current?.type === 'zoom') { const pts = Array.from(refPointers.current.values()); const dist = Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY); setRefTransform(prev => ({ ...prev, scale: Math.max(0.1, Math.min(10, refGesture.current.scale * (dist / refGesture.current.dist))) })); } else if (refPointers.current.size === 1 && refGesture.current?.type === 'pan') { setRefTransform(prev => ({ ...prev, x: refGesture.current.originX + (e.clientX - refGesture.current.startX), y: refGesture.current.originY + (e.clientY - refGesture.current.startY) })); } }} onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); refPointers.current.delete(e.pointerId); if (refPointers.current.size < 2) refGesture.current = null; }} onPointerCancel={e => { e.currentTarget.releasePointerCapture(e.pointerId); refPointers.current.delete(e.pointerId); refGesture.current = null; }}>
            {refImage && <img src={refImage} style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', transform: `translate(${refTransform.x}px, ${refTransform.y}px) scale(${refTransform.scale})` }} />}
          </div>
          <div style={{ position: 'absolute', right: 0, bottom: 0, width: 44, height: 44, display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', padding: 10, cursor: 'nwse-resize' }} onPointerDown={e => { e.stopPropagation(); isResizingWin.current = true; }} onPointerMove={e => isResizingWin.current && setWinSize({ width: Math.max(150, e.clientX - winPos.x), height: Math.max(200, e.clientY - winPos.y) })} onPointerUp={() => isResizingWin.current = false}><Grip size={24} color="#9ca3af" /></div>
        </div>

        {/* 評価結果モーダル UI */}
        {evaluationResult && (
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', backdropFilter: 'blur(4px)' }}>
            <div style={{ width: '100%', maxWidth: '1400px', display: 'flex', flexDirection: 'column', height: '100%', padding: '30px', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '32px', fontWeight: '800', color: '#fff', margin: '0 0 5px 0' }}>Score: {evaluationResult.score}</h2>
                  <p style={{ fontSize: '18px', color: '#e5e7eb', margin: '0 0 12px 0', fontWeight: '500' }}>{evaluationResult.evaluation_message}</p>
                  
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <span style={{ backgroundColor: '#374151', padding: '4px 12px', borderRadius: '12px', fontSize: '14px', color: '#d1d5db', fontWeight: '800' }}>
                      骨格バランス: {evaluationResult.balance_score}
                    </span>
                    <span style={{ backgroundColor: '#374151', padding: '4px 12px', borderRadius: '12px', fontSize: '14px', color: '#d1d5db', fontWeight: '800' }}>
                      シルエット: {evaluationResult.silhouette_score}
                    </span>
                  </div>
                </div>
                
                <button className="tool-btn" onClick={() => setEvaluationResult(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={36} color="#fff" />
                </button>
              </div>
              
              <div style={{ flex: 1, display: 'flex', gap: '20px', overflowX: 'auto', alignItems: 'center' }}>
                {[
                  {id:'reference',l:'お手本(骨格)'},
                  {id:'sketch',l:'自分(骨格)'},
                  {id:'silhouette_ref',l:'お手本(ﾏｽｸ)'},
                  {id:'silhouette_sketch',l:'自分(ﾏｽｸ)'},
                  {id:'overlay',l:'総合判定'}
                ].map(item => (
                  <div key={item.id} style={{ flex: '0 0 auto', width: '320px', height: '100%', maxHeight: '75vh', backgroundColor: '#1f2937', borderRadius: '16px', padding: '15px', display: 'flex', flexDirection: 'column' }}>
                    <span style={{ color: '#9ca3af', fontSize: '14px', fontWeight: '800', marginBottom: '10px', textAlign: 'center' }}>{item.l}</span>
                    <img src={`data:image/png;base64,${evaluationResult.images[item.id]}`} style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#fff', borderRadius: '12px' }} />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
                <button className="tool-btn" onClick={() => setEvaluationResult(null)} style={{ padding: '16px 48px', backgroundColor: '#df4b26', color: 'white', border: 'none', borderRadius: '30px', fontSize: '18px', fontWeight: '800', cursor: 'pointer', boxShadow: '0 4px 12px rgba(223, 75, 38, 0.3)' }}>
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 左側ツールバー (ペンの太さ・不透明度) */}
      <div style={{ width: 55, backgroundColor: '#ffffff', borderLeft: '1px solid #f3f4f6', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0', gap: 20, zIndex: 10, boxShadow: '-4px 0 16px rgba(0,0,0,0.03)' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: '100%' }}>
          <div style={{ color: '#9ca3af' }}>{tool === 'pen' ? <Pencil size={20} /> : <Eraser size={20} />}</div>
          <input type="range" className="modern-slider" min="1" max={tool === 'pen' ? 60 : 100} value={tool === 'pen' ? penWidth : eraserWidth} onChange={e => { const v = parseInt(e.target.value); tool === 'pen' ? setPenWidth(v) : setEraserWidth(v); }} />
          <div style={{ fontSize: 11, fontWeight: '800', color: '#4b5563' }}>{tool === 'pen' ? penWidth : eraserWidth}px</div>
        </div>

        <div style={{ width: '40%', height: 2, backgroundColor: '#f3f4f6', borderRadius: 1 }} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: '100%' }}>
          <div style={{ fontSize: 11, fontWeight: '800', color: '#9ca3af' }}>濃さ</div>
          <input type="range" className="modern-slider" min="1" max="100" value={tool === 'pen' ? penOpacity : eraserOpacity} onChange={e => tool === 'pen' ? setPenOpacity(parseInt(e.target.value)) : setEraserOpacity(parseInt(e.target.value))} />
          <div style={{ fontSize: 11, fontWeight: '800', color: '#4b5563' }}>{tool === 'pen' ? penOpacity : eraserOpacity}%</div>
        </div>
      </div>

      {/* 右側ツールバー (レイヤー・ツール・評価ボタン) */}
      <div style={{ width: 90, backgroundColor: '#ffffff', borderLeft: '1px solid #f3f4f6', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0', gap: 16, zIndex: 10, boxShadow: '-4px 0 16px rgba(0,0,0,0.03)' }}>
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', width: '100%' }}>
          <button className="tool-btn" style={btnStyle(showLayerMenu || activeLayer !== 0)} onClick={() => { setShowLayerMenu(!showLayerMenu); setShowColorPicker(false); }}>
            <Layers size={24} />
            <span style={{ fontSize: 11, fontWeight: '800', marginTop: 2 }}>L{activeLayer + 1}</span>
          </button>
          
          {showLayerMenu && (
            <div style={{ position: 'absolute', right: 85, top: 0, backgroundColor: 'white', padding: '16px', borderRadius: 20, zIndex: 200, boxShadow: '0 12px 36px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: 12, width: 240, border: '1px solid #f3f4f6' }}>
              <div style={{ fontSize: 13, fontWeight: '800', color: '#4b5563', textAlign: 'center', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Layers size={18} /> レイヤー設定
              </div>
              
              {[0, 1].map(layerIdx => (
                <div key={layerIdx} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px', backgroundColor: activeLayer === layerIdx ? '#fff4f0' : '#f9fafb', border: activeLayer === layerIdx ? '2px solid #df4b26' : '2px solid transparent', borderRadius: 12, transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <button onClick={() => setActiveLayer(layerIdx)} style={{ background: 'none', border: 'none', fontSize: 14, fontWeight: '800', color: activeLayer === layerIdx ? '#df4b26' : '#6b7280', cursor: 'pointer', padding: 0 }}>
                      Layer {layerIdx + 1}
                    </button>
                    <button className="tool-btn" onClick={() => setLayerSettings(prev => prev.map((l, i) => i === layerIdx ? { ...l, visible: !l.visible } : l))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: layerSettings[layerIdx].visible ? '#4b5563' : '#d1d5db', padding: 0, display: 'flex' }}>
                      {layerSettings[layerIdx].visible ? <Eye size={20} /> : <EyeOff size={20} />}
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: '800', color: '#9ca3af' }}>濃さ</span>
                    <input type="range" min="0" max="100" value={Math.round(layerSettings[layerIdx].opacity * 100)} onChange={(e) => setLayerSettings(prev => prev.map((l, i) => i === layerIdx ? { ...l, opacity: parseInt(e.target.value) / 100 } : l))} style={{ flex: 1, accentColor: '#df4b26' }} />
                    <span style={{ fontSize: 11, fontWeight: '800', color: '#6b7280', width: 32, textAlign: 'right' }}>{Math.round(layerSettings[layerIdx].opacity * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ height: 2, width: '40%', backgroundColor: '#f3f4f6', borderRadius: 1 }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: '100%' }}>
          <button className="tool-btn" style={btnStyle(uploadedSketch !== null)} onClick={() => sketchInputRef.current.click()}>
            <Upload size={24} />
            <span style={{ fontSize: 10, fontWeight: '800', marginTop: 2 }}>読込</span>
          </button>
          <input type="file" accept="image/*" ref={sketchInputRef} onChange={e => { const f = e.target.files[0]; if (f) { const r = new FileReader(); r.onload = (ev) => setUploadedSketch(ev.target.result); r.readAsDataURL(f); } }} style={{ display: 'none' }} />
          {uploadedSketch && (
            <div style={{ position: 'relative', width: 44, height: 44, border: '2px solid #df4b26', borderRadius: 8, overflow: 'hidden', marginTop: 4 }}>
              <img src={uploadedSketch} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div onClick={() => setUploadedSketch(null)} style={{ position: 'absolute', top: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', color: 'white', padding: 4, borderBottomLeftRadius: 4, cursor: 'pointer' }}><X size={12} /></div>
            </div>
          )}
        </div>

        <div style={{ height: 2, width: '40%', backgroundColor: '#f3f4f6', borderRadius: 1 }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', width: '100%' }}>
          <button className="tool-btn" style={btnStyle(tool === 'pen' && !uploadedSketch)} onClick={() => {setTool('pen'); setUploadedSketch(null); setShowColorPicker(false); setShowLayerMenu(false);}}>
            <Pencil size={24} />
            <span style={{ fontSize: 11, fontWeight: '800', marginTop: 2 }}>ペン</span>
          </button>
          
          <div className="tool-btn" onClick={() => { setShowColorPicker(!showColorPicker); setShowLayerMenu(false); }} style={{ marginTop: 12, width: 36, height: 36, borderRadius: '50%', backgroundColor: penColor, border: '3px solid #e5e7eb', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} />
          
          {showColorPicker && (
            <div style={{ position: 'absolute', right: 85, top: 0, backgroundColor: 'white', padding: 24, borderRadius: 20, zIndex: 200, boxShadow: '0 12px 36px rgba(0,0,0,0.15)', border: '1px solid #f3f4f6' }}>
              <CustomColorPicker color={penColor} onChange={setPenColor} />
              <div style={{ marginTop: 20, paddingTop: 20, borderTop: '2px solid #f3f4f6', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontSize: 12, fontWeight: '800', color: '#9ca3af', textAlign: 'center' }}>最近使った色</span>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                  {colorHistory.map((c, i) => (
                    <div className="tool-btn" key={i} onClick={() => setPenColor(c)} style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: c, border: '2px solid #e5e7eb', cursor: 'pointer', boxShadow: penColor === c ? '0 0 0 3px #df4b26' : 'none' }} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        
        <button className="tool-btn" style={btnStyle(tool === 'eraser')} onClick={() => { setTool('eraser'); setShowColorPicker(false); setShowLayerMenu(false); }}>
          <Eraser size={24} />
          <span style={{ fontSize: 11, fontWeight: '800', marginTop: 2 }}>消しゴム</span>
        </button>
        
        {/* 指とペンの判別（Apple Pencil対応を想定） */}
        <button className="tool-btn" style={btnStyle(pencilOnly)} onClick={() => setPencilOnly(!pencilOnly)}>
          {pencilOnly ? <PenTool size={24} /> : <Hand size={24} />}
          <span style={{ fontSize: 10, fontWeight: '800', marginTop: 2 }}>{pencilOnly ? 'ペンのみ' : 'ペン+指'}</span>
        </button>

        <div style={{ flex: 1 }} />
        
        <button className="tool-btn" style={{ ...btnStyle(false), color: '#ef4444', backgroundColor: '#fee2e2' }} onClick={handleClearLayer}>
          <Trash2 size={24} />
          <span style={{ fontSize: 11, fontWeight: '800', marginTop: 2 }}>全消し</span>
        </button>
        
        <button className="tool-btn" style={{ ...btnStyle(false), color: isEvaluating ? '#9ca3af' : '#fff', backgroundColor: isEvaluating ? '#f3f4f6' : '#10b981', boxShadow: isEvaluating ? 'none' : '0 4px 12px rgba(16, 185, 129, 0.3)' }} onClick={handleEvaluate} disabled={isEvaluating}>
          <Send size={24} />
          <span style={{ fontSize: 11, fontWeight: '800', marginTop: 2 }}>評価</span>
        </button>
      </div>
    </div>
  );
}
export default App;