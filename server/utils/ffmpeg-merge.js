const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;
const fs = require("fs");
const path = require("path");

// 设置 ffmpeg 和 ffprobe 路径
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// 辅助函数
function mergeAudioFiles(inputFiles, outputFile) {
  return new Promise((resolve, reject) => {
    if (!inputFiles || inputFiles.length === 0) {
      return reject(new Error("无输入文件可合并"));
    }

    // 确保输出目录存在
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const command = ffmpeg();

    // 考虑到可能是按照顺序依次说话，添加全部文件
    inputFiles.forEach((file) => {
      command.input(file);
    });

    // 这里处理合并
    command
      .on("error", function (err) {
        console.log("出现错误: " + err.message);
        reject(err);
      })
      .on("end", function () {
        console.log("合并完成!");
        resolve(outputFile);
      })
      .mergeToFile(outputFile);
  });
}

function cleanUpTempFiles(tempFiles) {
  tempFiles.forEach((file) => {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
        console.log(`已删除 ${file}`);
      } catch (err) {
        console.error(`删除失败 ${file}`, err);
      }
    }
  });
}

module.exports = {
  mergeAudioFiles,
  cleanUpTempFiles,
};
