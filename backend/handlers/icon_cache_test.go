package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"flatnasgo-backend/config"

	"github.com/gin-gonic/gin"
)

func TestSanitizeIconCacheName(t *testing.T) {
	cases := []struct {
		name string
		in   string
		ok   bool
	}{
		{"正常 sha 文件名", "9f2c1a.webp", true},
		{"大写后缀", "abc123.PNG", true},
		{"带空格会被 trim", "  a1.svg  ", true},
		{"空串", "", false},
		{"当前目录", ".", false},
		{"上级目录", "..", false},
		{"路径穿越 ../", "../secret.webp", false},
		{"路径穿越内嵌", "a/../../b.webp", false},
		{"正斜杠", "sub/x.webp", false},
		{"反斜杠", `sub\x.webp`, false},
		{"非图片后缀", "notes.txt", false},
		{"无后缀", "abcdef", false},
	}

	for _, c := range cases {
		got, ok := sanitizeIconCacheName(c.in)
		if ok != c.ok {
			t.Fatalf("in=%q expected ok=%v got ok=%v (name=%q)", c.in, c.ok, ok, got)
		}
		if ok && got == "" {
			t.Fatalf("in=%q ok 时不应返回空名字", c.in)
		}
	}
}

func TestIconCacheRefKey(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"/icon-cache/abc.webp", "abc.webp"},
		{"http://192.168.1.2:8080/icon-cache/ABC.WebP", "abc.webp"},
		{"/icon-cache/abc.webp?t=123", "abc.webp"},
		{"/icon-cache/abc.webp#frag", "abc.webp"},
		{"/icon-cache/", ""},
		{"/backgrounds/x.png", ""},
		{"https://cdn.example.com/logo.svg", ""},
		{"", ""},
	}

	for _, c := range cases {
		if got := iconCacheRefKey(c.in); got != c.want {
			t.Fatalf("in=%q expected %q got %q", c.in, c.want, got)
		}
	}
}

func TestCollectIconCacheRefs(t *testing.T) {
	counts := map[string]int{}
	payload := map[string]any{
		"groups": []any{
			map[string]any{
				"items": []any{
					map[string]any{"icon": "/icon-cache/aaa.webp"},
					map[string]any{"icon": "/icon-cache/bbb.png", "backgroundImage": "/icon-cache/aaa.webp"},
					map[string]any{"icon": "https://x.top/icon-cache/CCC.svg"},
					map[string]any{"icon": "/backgrounds/not-an-icon.png"},
				},
			},
		},
		"widgets": []any{
			map[string]any{"data": map[string]any{"logo": "/icon-cache/aaa.webp"}},
		},
	}

	collectIconCacheRefs(payload, counts)

	if counts["aaa.webp"] != 3 {
		t.Fatalf("aaa.webp 期望 3 次，实际 %d", counts["aaa.webp"])
	}
	if counts["bbb.png"] != 1 {
		t.Fatalf("bbb.png 期望 1 次，实际 %d", counts["bbb.png"])
	}
	if counts["ccc.svg"] != 1 {
		t.Fatalf("ccc.svg 期望 1 次（含大写归一化），实际 %d", counts["ccc.svg"])
	}
	if _, exists := counts["not-an-icon.png"]; exists {
		t.Fatalf("背景图路径不该被算成图标缓存引用")
	}
	if len(counts) != 3 {
		t.Fatalf("期望 3 个 key，实际 %d: %v", len(counts), counts)
	}
}

// setupIconCacheEnv 把 DataDir / UsersDir / IconCacheDir 指向临时目录，并返回清理函数。
func setupIconCacheEnv(t *testing.T) (usersDir string, iconDir string) {
	t.Helper()
	oldDataDir, oldUsersDir, oldIconDir := config.DataDir, config.UsersDir, config.IconCacheDir

	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	usersDir = filepath.Join(dataDir, "users")
	iconDir = filepath.Join(dataDir, "icon-cache")
	for _, dir := range []string{dataDir, usersDir, iconDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}

	config.DataDir = dataDir
	config.UsersDir = usersDir
	config.IconCacheDir = iconDir

	t.Cleanup(func() {
		config.DataDir = oldDataDir
		config.UsersDir = oldUsersDir
		config.IconCacheDir = oldIconDir
	})
	return usersDir, iconDir
}

func writeJSONFile(t *testing.T, path string, payload any) {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestIconCacheReferenceCountsFallsBackToDataJSON(t *testing.T) {
	usersDir, _ := setupIconCacheEnv(t)

	// 没有 users/admin.json 时，单用户模式的 data.json 必须被算进来
	writeJSONFile(t, filepath.Join(config.DataDir, "data.json"), map[string]any{
		"items": []any{map[string]any{"icon": "/icon-cache/dataonly.webp"}},
	})
	writeJSONFile(t, filepath.Join(usersDir, "bob.json"), map[string]any{
		"items": []any{map[string]any{"icon": "/icon-cache/dataonly.webp"}},
	})

	counts := IconCacheReferenceCounts()
	if counts["dataonly.webp"] != 2 {
		t.Fatalf("期望 dataonly.webp = 2，实际 %d（counts=%v）", counts["dataonly.webp"], counts)
	}
}

func TestIconCacheReferenceCountsSkipsDataJSONWhenAdminFileExists(t *testing.T) {
	usersDir, _ := setupIconCacheEnv(t)

	// users/admin.json 存在 → data.json 不该再被统计一遍，避免重复计数
	writeJSONFile(t, filepath.Join(usersDir, "admin.json"), map[string]any{
		"items": []any{map[string]any{"icon": "/icon-cache/dup.webp"}},
	})
	writeJSONFile(t, filepath.Join(config.DataDir, "data.json"), map[string]any{
		"items": []any{map[string]any{"icon": "/icon-cache/dup.webp"}},
	})

	counts := IconCacheReferenceCounts()
	if counts["dup.webp"] != 1 {
		t.Fatalf("期望 dup.webp = 1（不重复计数），实际 %d", counts["dup.webp"])
	}
}

func TestListIconCacheReportsRefCountsAndTotals(t *testing.T) {
	gin.SetMode(gin.TestMode)
	usersDir, iconDir := setupIconCacheEnv(t)

	if err := os.WriteFile(filepath.Join(iconDir, "used.webp"), []byte("12345"), 0o644); err != nil {
		t.Fatalf("write used: %v", err)
	}
	if err := os.WriteFile(filepath.Join(iconDir, "orphan.png"), []byte("123"), 0o644); err != nil {
		t.Fatalf("write orphan: %v", err)
	}
	// 干扰项：非图片文件不能出现在列表里
	if err := os.WriteFile(filepath.Join(iconDir, "readme.txt"), []byte("nope"), 0o644); err != nil {
		t.Fatalf("write txt: %v", err)
	}

	writeJSONFile(t, filepath.Join(usersDir, "bob.json"), map[string]any{
		"items": []any{
			map[string]any{"icon": "/icon-cache/used.webp"},
			map[string]any{"icon": "/icon-cache/used.webp"},
		},
	})

	router := gin.New()
	router.GET("/api/icon-cache/list", ListIconCache)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/icon-cache/list", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Success           bool             `json:"success"`
		Files             []iconCacheEntry `json:"files"`
		TotalSize         int64            `json:"totalSize"`
		TotalCount        int              `json:"totalCount"`
		UnreferencedCount int              `json:"unreferencedCount"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, w.Body.String())
	}

	if !resp.Success {
		t.Fatalf("success 应为 true")
	}
	if resp.TotalCount != 2 {
		t.Fatalf("totalCount 期望 2（txt 不算），实际 %d", resp.TotalCount)
	}
	if resp.TotalSize != 8 {
		t.Fatalf("totalSize 期望 8，实际 %d", resp.TotalSize)
	}
	if resp.UnreferencedCount != 1 {
		t.Fatalf("unreferencedCount 期望 1，实际 %d", resp.UnreferencedCount)
	}

	byName := map[string]iconCacheEntry{}
	for _, f := range resp.Files {
		byName[f.Name] = f
	}
	if byName["used.webp"].RefCount != 2 {
		t.Fatalf("used.webp refCount 期望 2，实际 %d", byName["used.webp"].RefCount)
	}
	if byName["orphan.png"].RefCount != 0 {
		t.Fatalf("orphan.png refCount 期望 0，实际 %d", byName["orphan.png"].RefCount)
	}
	if byName["used.webp"].Path != "/icon-cache/used.webp" {
		t.Fatalf("path 期望 /icon-cache/used.webp，实际 %q", byName["used.webp"].Path)
	}
}

func TestDeleteIconCacheRequiresForceWhenInUse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	usersDir, iconDir := setupIconCacheEnv(t)

	target := filepath.Join(iconDir, "busy.webp")
	if err := os.WriteFile(target, []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	writeJSONFile(t, filepath.Join(usersDir, "bob.json"), map[string]any{
		"items": []any{map[string]any{"icon": "/icon-cache/busy.webp"}},
	})

	router := gin.New()
	router.DELETE("/api/icon-cache/:name", DeleteIconCache)

	// 1) 未加 force → 409，且文件仍在
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/api/icon-cache/busy.webp", nil))
	if w.Code != http.StatusConflict {
		t.Fatalf("期望 409，实际 %d body=%s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatalf("409 后文件不应被删除: %v", err)
	}

	// 2) force=1 → 200，文件消失
	w = httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/api/icon-cache/busy.webp?force=1", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("force 后期望 200，实际 %d body=%s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("force 删除后文件应不存在，err=%v", err)
	}
}

func TestDeleteIconCacheRejectsTraversal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	_, iconDir := setupIconCacheEnv(t)

	// 造一个「上级目录里的文件」，确认不会被路径穿越删掉
	outside := filepath.Join(filepath.Dir(iconDir), "keep.webp")
	if err := os.WriteFile(outside, []byte("keep"), 0o644); err != nil {
		t.Fatalf("write outside: %v", err)
	}

	// 直接构造带穿越串的路由参数，精确验证 sanitize 这一层（不依赖 gin 的分段行为）
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/icon-cache/x", nil)
	c.Params = gin.Params{{Key: "name", Value: "../keep.webp"}}
	DeleteIconCache(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("路径穿越期望 400，实际 %d body=%s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("越界文件必须还在: %v", err)
	}
}

func TestCleanupIconCacheOnlyRemovesUnreferenced(t *testing.T) {
	gin.SetMode(gin.TestMode)
	usersDir, iconDir := setupIconCacheEnv(t)

	for _, name := range []string{"keep.webp", "drop1.png", "drop2.svg"} {
		if err := os.WriteFile(filepath.Join(iconDir, name), []byte("data"), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	writeJSONFile(t, filepath.Join(usersDir, "bob.json"), map[string]any{
		"items": []any{map[string]any{"icon": "/icon-cache/keep.webp"}},
	})

	router := gin.New()
	router.POST("/api/icon-cache/cleanup", CleanupIconCache)

	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/icon-cache/cleanup", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Success    bool     `json:"success"`
		Deleted    []string `json:"deleted"`
		FreedBytes int64    `json:"freedBytes"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if len(resp.Deleted) != 2 {
		t.Fatalf("期望删掉 2 个，实际 %v", resp.Deleted)
	}
	if resp.FreedBytes != 8 {
		t.Fatalf("freedBytes 期望 8，实际 %d", resp.FreedBytes)
	}
	if _, err := os.Stat(filepath.Join(iconDir, "keep.webp")); err != nil {
		t.Fatalf("被引用的图标必须保留: %v", err)
	}
	for _, gone := range []string{"drop1.png", "drop2.svg"} {
		if _, err := os.Stat(filepath.Join(iconDir, gone)); !os.IsNotExist(err) {
			t.Fatalf("%s 应被删除，err=%v", gone, err)
		}
	}
}

func TestBatchDeleteIconCacheSkipsReferencedWithoutForce(t *testing.T) {
	gin.SetMode(gin.TestMode)
	usersDir, iconDir := setupIconCacheEnv(t)

	for _, name := range []string{"used.webp", "free.webp"} {
		if err := os.WriteFile(filepath.Join(iconDir, name), []byte("x"), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	writeJSONFile(t, filepath.Join(usersDir, "bob.json"), map[string]any{
		"items": []any{map[string]any{"icon": "/icon-cache/used.webp"}},
	})

	router := gin.New()
	router.POST("/api/icon-cache/batch-delete", BatchDeleteIconCache)

	body := strings.NewReader(`{"names":["used.webp","free.webp","../evil.png","free.webp"]}`)
	req := httptest.NewRequest(http.MethodPost, "/api/icon-cache/batch-delete", body)
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}

	var resp struct {
		Success bool     `json:"success"`
		Deleted []string `json:"deleted"`
		Skipped []string `json:"skipped"`
		Failed  []string `json:"failed"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if len(resp.Deleted) != 1 || resp.Deleted[0] != "free.webp" {
		t.Fatalf("deleted 期望 [free.webp]，实际 %v", resp.Deleted)
	}
	if len(resp.Skipped) != 1 || resp.Skipped[0] != "used.webp" {
		t.Fatalf("skipped 期望 [used.webp]，实际 %v", resp.Skipped)
	}
	if len(resp.Failed) != 1 || resp.Failed[0] != "../evil.png" {
		t.Fatalf("failed 期望 [../evil.png]，实际 %v", resp.Failed)
	}
	if _, err := os.Stat(filepath.Join(iconDir, "used.webp")); err != nil {
		t.Fatalf("被引用图标必须保留: %v", err)
	}
}
