// indextts2Service 代码占位

async function generate({ dialogue, projectName, tempFilename, localChars }) {
  console.log("即将使用 IndexTTS2 方案生成 TTS:", dialogue.text);
  
  // TODO: 后续在这里实现 IndexTTS-2 的 API 调用逻辑
  // const API_URL = 'http://localhost:xxxx/api/tts'; // 本地或远程地址
  // 1. 根据 localChars 和 dialogue.role 等拼凑参数
  // 2. 发起请求
  // 3. 将文件写入到 tempFilename

  throw new Error("IndexTTS2 方案尚未完全实现，此处为预留逻辑。");
}

module.exports = {
  generate
};
