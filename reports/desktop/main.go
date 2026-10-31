// 내 보고서함 — 보고서 뷰어(index.html)를 내장한 실행파일.
// 실행하면 이 컴퓨터 안(127.0.0.1)에서만 열리는 작은 서버를 띄우고 기본 브라우저로 엽니다.
package main

import (
	_ "embed"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"runtime"
)

//go:embed index.html
var page []byte

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func main() {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fmt.Println("서버를 열지 못했어요:", err)
		return
	}
	url := fmt.Sprintf("http://%s/", ln.Addr().String())
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(page)
	})
	fmt.Println("내 보고서함이 브라우저에서 열려요:", url)
	fmt.Println("다 보셨으면 이 창을 닫으세요.")
	openBrowser(url)
	_ = http.Serve(ln, nil)
}
