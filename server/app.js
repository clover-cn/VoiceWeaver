const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// 挂载静态上传目录用于前端访问音频
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "配音后端正在运行" });
});

// 路由挂载位置
const projectRoutes = require("./routes/project");
const llmRoutes = require("./routes/llm");
const ttsRoutes = require("./routes/tts");
const audioRoutes = require("./routes/audio");
const readerRoutes = require("./routes/reader");

app.use("/api/projects", projectRoutes);
app.use("/api/llm", llmRoutes);
app.use("/api/tts", ttsRoutes);
app.use("/api/audio", audioRoutes);
app.use("/api/reader", readerRoutes);

app.listen(port, () => {
  console.log(`服务器监听地址 http://localhost:${port}`);
});
