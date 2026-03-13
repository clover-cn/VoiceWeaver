const siliconflowService = require("./siliconflowService");
const indextts2Service = require("./indextts2Service");

// TTS 生成分发
async function generateAudio(provider, params) {
  console.log("使用 TTS 提供商：", provider);

  switch (provider) {
    case "siliconflow":
      return await siliconflowService.generate(params);
    case "indextts2":
      return await indextts2Service.generate(params);
    default:
      console.warn(`未知的 TTS 提供商 [${provider}]，请检查.env文件中的 TTS_DEFAULT_PROVIDER 设置，已回退使用默认方案 siliconflow`);
      return await siliconflowService.generate(params);
  }
}

module.exports = {
  generateAudio,
};
