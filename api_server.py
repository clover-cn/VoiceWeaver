import os
import sys
import uuid
import uvicorn
import shutil
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Optional, List
from fastapi.responses import FileResponse
from indextts.infer_v2 import IndexTTS2
from contextlib import asynccontextmanager

# 全局配置变量
ENABLE_FP16 = "--fp16" in sys.argv

# 全局TTS实例
tts = None
UPLOAD_DIR = "temp_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs("outputs", exist_ok=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global tts
    print("加载索引 Tts2 模型，可能需要一段时间")
    
    # 从环境变量读取设置并使用默认值
    cfg_path = os.getenv("TTS_CFG_PATH", "checkpoints/config.yaml")
    model_dir = os.getenv("TTS_MODEL_DIR", "checkpoints")
    use_fp16 = ENABLE_FP16
    use_cuda_kernel = os.getenv("TTS_USE_CUDA_KERNEL", "False").lower() == "true"
    use_deepspeed = os.getenv("TTS_USE_DEEPSPEED", "False").lower() == "true"
    
    try:
        tts = IndexTTS2(
            cfg_path=cfg_path, 
            model_dir=model_dir, 
            use_fp16=use_fp16, 
            use_cuda_kernel=use_cuda_kernel, 
            use_deepspeed=use_deepspeed
        )
        print("索引Tts2模型加载成功")
    except Exception as e:
        print(f"加载模型错误: {str(e)}")
        # 不阻止启动，允许用户查看 API，但调用 /api/tts 时会抛出 500 错误
    yield

app = FastAPI(title="IndexTTS2 API Server", description="索引 Tts2 API 调用代理 Node.js 集成", lifespan=lifespan)

class TTSRequest(BaseModel):
    text: str = Field(..., description="要合成的文本内容")
    spk_audio_prompt: str = Field(..., description="参考音色频文件路径")
    output_path: Optional[str] = Field(None, description="输出文件路径。不填则直接返回音频文件流")
    emo_audio_prompt: Optional[str] = Field(None, description="情感参考音频文件路径")
    emo_alpha: Optional[float] = Field(1.0, description="情感参考音频的权重 (0.0 - 1.0)")
    emo_vector: Optional[List[float]] = Field(None, description="8维情感向量")
    use_random: Optional[bool] = Field(False, description="是否开启随机情感采样")
    use_emo_text: Optional[bool] = Field(False, description="是否根据文本自动生成情感向量")
    emo_text: Optional[str] = Field(None, description="情感文本描述")
    verbose: Optional[bool] = Field(False, description="是否打印推理详情")

def remove_temp_file(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        print(f"删除临时文件时出错 {path}: {e}")

@app.post("/api/tts")
async def generate_tts(request: TTSRequest):
    """
    适用于音频提示已存储在服务器磁盘上的请求的标准 JSON 端点。
    """
    if tts is None:
        raise HTTPException(status_code=500, detail="TTS模型未正确加载")
    
    if not os.path.exists(request.spk_audio_prompt):
        raise HTTPException(status_code=400, detail=f"找不到音频: {request.spk_audio_prompt}")

    out_path = request.output_path
    if not out_path:
        out_path = f"outputs/gen_{uuid.uuid4().hex[:8]}.wav"
    else:
        parent_dir = os.path.dirname(out_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)

    try:
        kwargs = {
            "spk_audio_prompt": request.spk_audio_prompt,
            "text": request.text,
            "output_path": out_path,
            "emo_alpha": request.emo_alpha,
            "use_random": request.use_random,
            "use_emo_text": request.use_emo_text,
            "verbose": request.verbose
        }

        if request.emo_audio_prompt:
            if not os.path.exists(request.emo_audio_prompt):
                raise HTTPException(status_code=400, detail=f"情感音频提示未找到: {request.emo_audio_prompt}")
            kwargs["emo_audio_prompt"] = request.emo_audio_prompt
        
        if request.emo_vector:
            if len(request.emo_vector) != 8:
                raise HTTPException(status_code=400, detail="情绪向量必须是包含8个浮点数的列表")
            kwargs["emo_vector"] = request.emo_vector
            
        if request.emo_text:
            kwargs["emo_text"] = request.emo_text

        tts.infer(**kwargs)
        
        if request.output_path:
            return {"status": "success", "file_path": out_path}
        
        return FileResponse(out_path, media_type="audio/wav", filename=os.path.basename(out_path))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tts/upload")
async def generate_tts_with_upload(
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    spk_audio_file: UploadFile = File(...),
    output_path: Optional[str] = Form(None),
    emo_audio_file: Optional[UploadFile] = File(None),
    emo_alpha: Optional[float] = Form(1.0),
    emo_vector: Optional[str] = Form(None),  # 必须以 JSON 字符串形式传递，例如 "[0, 0, 0, 0, 0, 0, 0.45, 0]"
    use_random: Optional[bool] = Form(False),
    use_emo_text: Optional[bool] = Form(False),
    emo_text: Optional[str] = Form(None),
    verbose: Optional[bool] = Form(False)
):
    """
    支持直接文件上传的多部分表单数据端点
    """
    if tts is None:
        raise HTTPException(status_code=500, detail="TTS模型未正确加载")
        
    temp_files = []
    
    # 将上传的音频文件保存到临时位置
    spk_temp_path = os.path.join(UPLOAD_DIR, f"spk_{uuid.uuid4().hex[:8]}.wav")
    with open(spk_temp_path, "wb") as buffer:
        shutil.copyfileobj(spk_audio_file.file, buffer)
    temp_files.append(spk_temp_path)

    kwargs = {
        "spk_audio_prompt": spk_temp_path,
        "text": text,
        "emo_alpha": emo_alpha,
        "use_random": use_random,
        "use_emo_text": use_emo_text,
        "verbose": verbose
    }

    # 处理情绪音频文件上传（如果存在）
    if emo_audio_file:
        emo_temp_path = os.path.join(UPLOAD_DIR, f"emo_{uuid.uuid4().hex[:8]}.wav")
        with open(emo_temp_path, "wb") as buffer:
            shutil.copyfileobj(emo_audio_file.file, buffer)
        temp_files.append(emo_temp_path)
        kwargs["emo_audio_prompt"] = emo_temp_path
        
    if emo_vector:
        try:
            import json
            parsed_vector = json.loads(emo_vector)
            if not isinstance(parsed_vector, list) or len(parsed_vector) != 8:
                raise ValueError("解析的向量不是包含8个浮点数的列表")
            kwargs["emo_vector"] = parsed_vector
        except Exception:
             raise HTTPException(status_code=400, detail="emo_vector 必须是包含 8 个浮点数的有效 JSON 数组, e.g. '[0, 0, 0, 0, 0, 0, 0.45, 0]'")
             
    if emo_text:
        kwargs["emo_text"] = emo_text

    # 响应完成后清理临时上传的音频文件
    for temp_f in temp_files:
        background_tasks.add_task(remove_temp_file, temp_f)

    out_path = output_path
    if not out_path:
        out_path = f"outputs/gen_{uuid.uuid4().hex[:8]}.wav"
    else:
        parent_dir = os.path.dirname(out_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
            
    kwargs["output_path"] = out_path

    try:
        tts.infer(**kwargs)
        
        if output_path:
            return {"status": "success", "file_path": out_path}
            
        return FileResponse(out_path, media_type="audio/wav", filename=os.path.basename(out_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    # uv pip install fastapi uvicorn pydantic python-multipart
    # uv run api_server.py
    uvicorn.run(app, host="127.0.0.1", port=8000)
