//! 局域网只读查看：在选定端口提供待办列表的只读页面与 JSON 接口。
//! 用户显式开启后才启动；修改端口后需重启应用生效。

use crate::storage;
use std::io::{Read, Write};
use std::net::TcpListener;

pub const DEFAULT_PORT: u16 = 9600;

pub fn start(port: u16) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("0.0.0.0", port)) {
            Ok(l) => l,
            Err(_) => return, // 端口被占用则放弃，不影响主程序
        };
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || {
                let mut stream = stream;
                // 防止连上不发数据的客户端永久占住线程
                let timeout = Some(std::time::Duration::from_secs(3));
                let _ = stream.set_read_timeout(timeout);
                let _ = stream.set_write_timeout(timeout);
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let req = String::from_utf8_lossy(&buf);
                let path = req.split_whitespace().nth(1).unwrap_or("/");
                let s = storage::load_settings();
                let todos = storage::load_todos(&s);
                let (ctype, body) = match path {
                    "/api/todos" => (
                        "application/json; charset=utf-8",
                        serde_json::to_string(&todos).unwrap_or_else(|_| "[]".into()),
                    ),
                    _ => ("text/html; charset=utf-8", render_html(&todos)),
                };
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.flush();
            });
        }
    });
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn render_html(todos: &[storage::Todo]) -> String {
    let mut items = String::new();
    let mut pending = String::new();
    let mut done = String::new();
    let mut done_count = 0usize;
    for t in todos {
        let date = t
            .date
            .as_deref()
            .map(|d| format!(" · {}", esc(d)))
            .unwrap_or_default();
        let row = format!(
            "<div class=\"item{}\"><span class=\"mark\">{}</span><span>{}</span><span class=\"date\">{}</span></div>",
            if t.done { " done" } else { "" },
            if t.done { "✓" } else { "" },
            esc(&t.content),
            date
        );
        if t.done {
            done.push_str(&row);
            done_count += 1;
        } else {
            pending.push_str(&row);
        }
    }
    items.push_str(&pending);
    if done_count > 0 {
        items.push_str(&format!(
            "<div class=\"sep\">已完成 · {}</div>{done}",
            done_count
        ));
    }
    let total = todos.len();
    format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
<meta http-equiv=\"refresh\" content=\"15\">\
<title>memoPad</title><style>\
body{{margin:0;background:#17171c;color:#e9eaee;font-family:system-ui,'Microsoft YaHei UI',sans-serif;padding:24px;max-width:560px;margin:0 auto}}\
h1{{font-size:18px}}h1 span{{color:#f0a52a}}\
.sub{{color:#8a8d96;font-size:12px;margin-bottom:18px}}\
.item{{display:flex;gap:10px;align-items:baseline;background:#222228;border-radius:10px;padding:10px 14px;margin-bottom:8px}}\
.item.done span:nth-child(2){{text-decoration:line-through;opacity:.5}}\
.mark{{width:18px;color:#f0a52a;font-weight:700;flex:none}}\
.date{{margin-left:auto;color:#8a8d96;font-size:11px}}\
.sep{{color:#8a8d96;font-size:12px;margin:16px 0 8px}}\
</style></head><body>\
<h1>🗒️ memo<span>Pad</span> · 待办</h1>\
<div class=\"sub\">共 {total} 项 · 每 15 秒自动刷新 · 只读视图</div>\
{items}</body></html>"
    )
}
