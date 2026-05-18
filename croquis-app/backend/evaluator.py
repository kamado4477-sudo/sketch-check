import cv2
import numpy as np
import base64
from ultralytics import YOLO
from rembg import remove, new_session

class CroquisEvaluator:
    def __init__(self):
        print("⏳ AIモデル（YOLO）の準備中...")
        self.model = YOLO('yolov8n-pose.pt')
        self.session_anime = new_session("isnet-anime")

    def crop_to_drawing(self, img):
        if len(img.shape) == 3 and img.shape[2] == 4:
            bgr = img[:, :, :3]
            alpha = img[:, :, 3]
            bgr[alpha == 0] = [255, 255, 255]
            img = bgr
        
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        points = np.argwhere(gray < 240)
        if len(points) == 0: return img 

        y1, x1 = points.min(axis=0)
        y2, x2 = points.max(axis=0)
        h, w = img.shape[:2]
        margin_y, margin_x = int((y2 - y1) * 0.1), int((x2 - x1) * 0.1)
        ny1, nx1 = max(0, y1 - margin_y), max(0, x1 - margin_x)
        ny2, nx2 = min(h, y2 + margin_y), min(w, x2 + margin_x)
        return img[ny1:ny2, nx1:nx2]

    def encode_image_base64(self, img):
        _, buffer = cv2.imencode('.png', img)
        return base64.b64encode(buffer).decode('utf-8')

    def evaluate_images(self, img_m, img_s_raw):
        # スケッチの余白をクロップ
        img_s_cropped = self.crop_to_drawing(img_s_raw)
        h_m, w_m = img_m.shape[:2]

        # お手本画像の骨格検出
        res_m = self.model(img_m, conf=0.3, max_det=1)[0]

        # ① お手本マスク生成（輪郭埋めをしっかり行う）
        mask_m = remove(cv2.cvtColor(img_m, cv2.COLOR_BGR2RGBA))[:, :, 3]
        _, mask_m = cv2.threshold(mask_m, 128, 255, cv2.THRESH_BINARY)
        contours_m, _ = cv2.findContours(mask_m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        mask_m_filled = np.zeros_like(mask_m)
        cv2.drawContours(mask_m_filled, contours_m, -1, 255, thickness=cv2.FILLED)
        mask_m = mask_m_filled

        # ② スケッチマスク生成（dilateを削除し、お手本と条件を揃える）
        mask_s_raw = remove(cv2.cvtColor(img_s_cropped, cv2.COLOR_BGR2RGBA), session=self.session_anime)[:, :, 3]
        _, mask_s_raw = cv2.threshold(mask_s_raw, 50, 255, cv2.THRESH_BINARY)
        contours_s, _ = cv2.findContours(mask_s_raw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        mask_s_filled = np.zeros_like(mask_s_raw)
        cv2.drawContours(mask_s_filled, contours_s, -1, 255, thickness=cv2.FILLED)
        mask_s_raw = mask_s_filled 

        # ③ 位置合わせのためのバウンディングボックス取得
        x_m, y_m, w_m_box, h_m_box = cv2.boundingRect(mask_m)
        x_s, y_s, w_s_box, h_s_box = cv2.boundingRect(mask_s_raw)

        scale = h_m_box / h_s_box if h_s_box > 0 else 1.0

        # ④ 重心ではなく、バウンディングボックスの「中心」で位置を合わせる
        cX_m = x_m + w_m_box / 2
        cY_m = y_m + h_m_box / 2
        cX_s = x_s + w_s_box / 2
        cY_s = y_s + h_s_box / 2
        
        M_affine = np.float32([[scale, 0, cX_m - scale * cX_s], [0, scale, cY_m - scale * cY_s]])
        img_s_aligned = cv2.warpAffine(img_s_cropped, M_affine, (w_m, h_m), borderValue=(255,255,255))
        mask_s = cv2.warpAffine(mask_s_raw, M_affine, (w_m, h_m))

        # 位置合わせ後のスケッチで骨格検出
        res_s_aligned = self.model(img_s_aligned, conf=0.01, max_det=1)[0]
        
        # シルエット一致度 (IoU)
        iou = (np.sum((mask_m & mask_s) > 0) / np.sum((mask_m | mask_s) > 0) * 100) if np.sum(mask_m | mask_s) > 0 else 0
        silhouette_score = round(iou, 1)

        # バランス一致度 (骨格のズレから計算)
        balance_score = 0.0
        try:
            if res_m.keypoints is not None and res_s_aligned.keypoints is not None:
                kp_m = res_m.keypoints.xy[0].cpu().numpy()
                kp_s = res_s_aligned.keypoints.xy[0].cpu().numpy()
                conf_m = res_m.keypoints.conf[0].cpu().numpy()
                conf_s = res_s_aligned.keypoints.conf[0].cpu().numpy()
                
                valid_idx = (conf_m > 0.5) & (conf_s > 0.1)
                if np.sum(valid_idx) > 0:
                    dists = np.linalg.norm(kp_m[valid_idx] - kp_s[valid_idx], axis=1)
                    ref_height = h_m_box if h_m_box > 0 else h_m
                    normalized_dists = dists / ref_height
                    scores = np.maximum(0, 100 * (1 - normalized_dists / 0.15))
                    balance_score = round(float(np.mean(scores)), 1)
        except Exception as e:
            print(f"骨格スコア計算エラー: {e}")

        # 画像の生成
        out_m = res_m.plot()
        out_s = res_s_aligned.plot()
        
        mask_m_img = cv2.cvtColor(mask_m, cv2.COLOR_GRAY2BGR)
        mask_s_img = cv2.cvtColor(mask_s, cv2.COLOR_GRAY2BGR)
        overlay = cv2.addWeighted(img_m, 0.5, img_s_aligned, 0.5, 0)

        # 総合スコアとメッセージの生成
        total_score = round((balance_score + silhouette_score) / 2, 1)
        if total_score >= 80:
            msg = "素晴らしい！特徴をよく捉えられています👏"
        elif total_score >= 50:
            msg = "惜しい！あともう一歩です✨"
        else:
            msg = "まずは全体のバランスを意識してみましょう💪"

        return {
            "status": "success",
            "score": total_score,             
            "evaluation_message": msg,        
            "balance_score": balance_score,
            "silhouette_score": silhouette_score,
            "images": {
                "reference": self.encode_image_base64(out_m),
                "sketch": self.encode_image_base64(out_s),
                "silhouette_ref": self.encode_image_base64(mask_m_img),
                "silhouette_sketch": self.encode_image_base64(mask_s_img),
                "overlay": self.encode_image_base64(overlay)
            }
        }