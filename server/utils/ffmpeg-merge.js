const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;
const fs = require("fs");
const path = require("path");

// 设置 ffmpeg 和 ffprobe 路径
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// 辅助函数
function mergeAudioFiles(inputFiles, outputFile, pauseDuration = 0) {
  return new Promise(async (resolve, reject) => {
    if (!inputFiles || inputFiles.length === 0) {
      return reject(new Error("无输入文件可合并"));
    }

    // 确保输出目录存在
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    let filesToMerge = inputFiles;
    let silenceFile = null;

    if (pauseDuration > 0) {
      silenceFile = path.join(outputDir, `silence_${Date.now()}.mp3`);
      try {
        // 获取第一个文件的音频信息以匹配采样率和声道
        const getAudioInfo = (file) => {
          return new Promise((res) => {
            ffmpeg.ffprobe(file, (err, metadata) => {
              if (err) {
                console.warn("ffprobe 失败，使用默认音频参数:", err.message);
                return res({});
              }
              const audioStream = metadata?.streams?.find((s) => s.codec_type === "audio");
              res(audioStream || {});
            });
          });
        };

        const info = await getAudioInfo(inputFiles[0]);
        const sampleRate = info.sample_rate || 44100;
        const channels = info.channels || 2;
        const channelLayout = channels === 1 ? "mono" : "stereo";

        await new Promise((res, rej) => {
          ffmpeg().input(`anullsrc=r=${sampleRate}:cl=${channelLayout}`).inputFormat("lavfi").duration(pauseDuration).audioCodec("libmp3lame").save(silenceFile).on("end", res).on("error", rej);
        });

        filesToMerge = [];
        for (let i = 0; i < inputFiles.length; i++) {
          filesToMerge.push(inputFiles[i]);
          if (i < inputFiles.length - 1) {
            filesToMerge.push(silenceFile);
          }
        }
      } catch (err) {
        console.error("生成静音文件失败:", err);
        return reject(err);
      }
    }

    const command = ffmpeg();

    // 考虑到可能是按照顺序依次说话，添加全部文件
    filesToMerge.forEach((file) => {
      command.input(file);
    });

    // 这里处理合并
    command
      .on("error", function (err) {
        console.log("出现错误: " + err.message);
        if (silenceFile && fs.existsSync(silenceFile)) {
          try {
            fs.unlinkSync(silenceFile);
          } catch (e) {}
        }
        reject(err);
      })
      .on("end", function () {
        console.log("合并完成!");
        if (silenceFile && fs.existsSync(silenceFile)) {
          try {
            fs.unlinkSync(silenceFile);
          } catch (e) {}
        }
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
