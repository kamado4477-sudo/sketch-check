from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import uvicorn
from evaluator import CroquisEvaluator

app = FastAPI()

# CORS設定（iPad等、外部デバイスからのアクセスを許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

evaluator = CroquisEvaluator()

@app.post("/api/evaluate")
async def evaluate(sketch: UploadFile = File(...), reference: UploadFile = File(...)):
    try:
        # 画像の読み込み
        s_bytes = await sketch.read()
        img_s = cv2.imdecode(np.frombuffer(s_bytes, np.uint8), cv2.IMREAD_UNCHANGED)
        
        m_bytes = await reference.read()
        img_m = cv2.imdecode(np.frombuffer(m_bytes, np.uint8), cv2.IMREAD_COLOR)

        # 評価実行
        result = evaluator.evaluate_images(img_m, img_s)
        return {"status": "success", **result}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)