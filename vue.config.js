const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  lintOnSave: false,
  transpileDependencies: true,
  devServer: {
    client: {
      overlay: {
        // Element Plus 下拉框触发的 ResizeObserver 无害警告，过滤不弹
        runtimeErrors: (error) => {
          if (error.message === 'ResizeObserver loop completed with undelivered notifications.') {
            return false;
          }
          return true;
        }
      }
    }
  }
})
