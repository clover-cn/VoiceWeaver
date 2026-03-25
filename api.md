## 搜索小说

```bash
http://154.58.233.231:9080/reader3/searchBookMultiSSE
```

请求方式：GET

请求参数：

| 参数                | 默认 | 说明                             |
| :------------------ | :--- | :------------------------------- |
| **key**             |      | 搜索关键字                       |
| **concurrentCount** | 4    | 并发数(没有特殊需求可不传)       |
| **lastIndex**       | -1   | 搜索起始位置(没有特殊需求可不传) |

响应参数：

```
{
    "lastIndex": 1,
    "data": [
        {
            "bookUrl": "https://www.sudugu.org/554/",
            "origin": "https://www.sudugu.org",
            "originName": "速读谷",
            "type": 0,
            "name": "斗罗大陆IV终极斗罗",
            "author": "唐家三少",
            "coverUrl": "http://www.sudugu.org/files/cover/202510/53856429-35a9-4be2-897a-b4acb25d4b14.jpg",
            "intro": "已完结玄幻",
            "wordCount": "",
            "latestChapterTitle": "后记",
            "tocUrl": "",
            "time": 311,
            "originOrder": 4,
            "infoHtml": "",
            "tocHtml": ""
        },
        {
            "bookUrl": "https://www.biqugem.cc/book/112640/",
            "origin": "http://www.biqugem.cc",
            "originName": "📖笔趣阁手机版",
            "type": 0,
            "name": "斗破苍穹",
            "author": "天蚕土豆",
            "coverUrl": "https://www.biqugem.cc/cover/da/48/8e/da488ecec4d675cb59a33176cb0cc064.jpg",
            "intro": "这里是属于斗气的世界，没有花俏艳丽的魔法，有的，仅仅是繁衍到巅峰的斗气！新书等级制度：斗者，斗师，大斗师，斗灵，斗王，斗皇，斗宗，斗尊，斗圣，斗帝。",
            "wordCount": "",
            "latestChapterTitle": "第一千六百二十三章 结束，也是开始。（大结局）",
            "tocUrl": "",
            "time": 565,
            "originOrder": 0,
            "infoHtml": "",
            "tocHtml": ""
        },
}
```



## 获取章节列表

```
http://154.58.233.231:9080/reader3/getChapterList
```

请求方式：GET

请求参数：

| 参数              | 示例                                | 说明                                    |
| :---------------- | :---------------------------------- | :-------------------------------------- |
| **url**           | https://www.biqugem.cc/book/129964/ | 来自searchBookMultiSSE接口的bookUrl字段 |
| **bookSourceUrl** | https://www.sudugu.org              | 来自searchBookMultiSSE接口的origin字段  |

响应参数：

```
{
    "isSuccess": true,
    "errorMsg": "",
    "data": [
        {
            "url": "/book/129964/1.html",
            "title": "第1章 第二张觉醒武魂",
            "isVolume": false,
            "baseUrl": "https://www.biqugem.cc/book/129964/",
            "bookUrl": "https://www.biqugem.cc/book/129964/",
            "index": 0,
            "tag": ""
        },
        {
            "url": "/book/129964/2.html",
            "title": "第2章 第一魂环",
            "isVolume": false,
            "baseUrl": "https://www.biqugem.cc/book/129964/",
            "bookUrl": "https://www.biqugem.cc/book/129964/",
            "index": 1,
            "tag": ""
        },
    ]
}
```



## 获取小说正文

```
http://154.58.233.231:9080/reader3/getBookContent
```

请求方式：GET

请求参数：

| 参数      | 示例                                | 说明                                       |
| :-------- | :---------------------------------- | :----------------------------------------- |
| **url**   | https://www.biqugem.cc/book/129964/ | 来自getChapterList接口的bookUrl字段        |
| **index** | 0                                   | 来自getChapterList接口的index字段(默认为0) |

响应参数：

```
{
    "isSuccess": true,
    "errorMsg": "",
    "data": "月如银盘，漫天繁星。\n　　山崖之颠，萧炎斜躺在草地之上，嘴中叼中一根青草，微微嚼动，任由那淡淡的苦涩在嘴中弥漫开来…\n　　举起有些白皙的手掌，挡在眼前，目光透过手指缝隙，遥望着天空上那轮巨大的银月。\n　　“唉…”想起下午的测试，萧炎轻叹了一口气，懒懒的抽回手掌，双手枕着脑袋，眼神有些恍惚…\n　　“呵呵，有什么好想的，意料之中而已。”萧炎少年老成的摇了摇头，笑容却是有些勉强。\n　　“唉…”望着萧炎那依旧有些稚嫩的清秀脸庞，萧战叹了一口气，沉默了片刻，忽然道：“炎儿，你十五岁了吧？”\n“放心吧，父亲，我会尽力的！”抚摸着手指上的古朴戒指，萧炎抬头喃喃道。\n　　在萧炎抬头的那一刹，手指中的黑色古戒，却是忽然亮起了一抹极其微弱的诡异毫光，毫光眨眼便逝，没有引起任何人的察觉…"
}
```

