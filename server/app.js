const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "配音后端正在运行" });
});

// 路由挂载位置
const projectRoutes = require("./routes/project");
const llmRoutes = require("./routes/llm");
const ttsRoutes = require("./routes/tts");

app.use("/api/projects", projectRoutes);
app.use("/api/llm", llmRoutes);
app.use("/api/tts", ttsRoutes);

app.listen(port, () => {
  console.log(`服务器监听地址 http://localhost:${port}`);
});
