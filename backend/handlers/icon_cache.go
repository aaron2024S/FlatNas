package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"flatnasgo-backend/config"

	"github.com/gin-gonic/gin"
)

// 「图标缓存管理」相关接口。
//
// 背景：POST /api/icon-cache 早就把远程/上传的图标转成 webp 落盘到
// config.IconCacheDir（文件名 = 内容 sha256），但一直没有「列出 / 删除 / 统计」
// 的入口 —— 目录只增不减，用户也看不到自己传过什么。
//
// 卡片（models.Item）只保存图标**路径**（形如 /icon-cache/<sha>.webp），
// 所以「这个图标被几张卡片用了」必须**反向扫描**用户配置才能算出来。
// 这也是「未使用」标记与「一键清理未引用」的基础。

const iconCacheURLPrefix = "/icon-cache/"

var iconCacheFileExts = []string{".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico"}

// iconCacheEntry 是列表接口返回的单个缓存图标。
type iconCacheEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	ModifiedAt int64  `json:"modifiedAt"`
	RefCount   int    `json:"refCount"`
}

func isIconCacheFile(name string) bool {
	lower := strings.ToLower(name)
	for _, ext := range iconCacheFileExts {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}

// sanitizeIconCacheName 复用背景图那套防目录穿越校验：只允许纯文件名 + 受支持的图片后缀。
func sanitizeIconCacheName(name string) (string, bool) {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		return "", false
	}
	if strings.ContainsAny(name, `/\`) || strings.Contains(name, "..") {
		return "", false
	}
	if filepath.Base(name) != name {
		return "", false
	}
	if !isIconCacheFile(name) {
		return "", false
	}
	return name, true
}

// iconCacheRefKey 从一段字符串里抽出 /icon-cache/ 之后、到 ?#/ 之前的文件名。
// 同时兼容 "/icon-cache/x.webp" 与 "http://host/icon-cache/x.webp"。
func iconCacheRefKey(value string) string {
	idx := strings.Index(value, iconCacheURLPrefix)
	if idx < 0 {
		return ""
	}
	rest := value[idx+len(iconCacheURLPrefix):]
	if cut := strings.IndexAny(rest, "?#/"); cut >= 0 {
		rest = rest[:cut]
	}
	return strings.ToLower(strings.TrimSpace(rest))
}

// collectIconCacheRefs 递归遍历任意 JSON 值，统计其中的图标引用次数。
// 用「深扫任意字符串」而不是只翻 items[].icon，是为了顺带覆盖未开组件里的图标字段。
func collectIconCacheRefs(node any, counts map[string]int) {
	switch v := node.(type) {
	case string:
		if key := iconCacheRefKey(v); key != "" {
			counts[key]++
		}
	case []any:
		for _, item := range v {
			collectIconCacheRefs(item, counts)
		}
	case map[string]any:
		for _, item := range v {
			collectIconCacheRefs(item, counts)
		}
	}
}

// iconConfigFilePaths 返回需要参与引用统计的配置文件。
// 注意多用户 / 单用户两种模式下 admin 的数据位置不同（见 handlers/auth.go:34-38），
// 且 default.json 只是「新用户模板」，不作为真实引用来源。
func iconConfigFilePaths() []string {
	paths := make([]string, 0, 8)
	hasAdminUserFile := false

	entries, err := os.ReadDir(config.UsersDir)
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
				continue
			}
			if strings.EqualFold(entry.Name(), "admin.json") {
				hasAdminUserFile = true
			}
			paths = append(paths, filepath.Join(config.UsersDir, entry.Name()))
		}
	}

	// 单用户模式下 admin 的数据在 data.json；若 users/admin.json 已存在就不再算一遍，避免重复计数
	if !hasAdminUserFile {
		dataJSON := filepath.Join(config.DataDir, "data.json")
		if info, statErr := os.Stat(dataJSON); statErr == nil && !info.IsDir() {
			paths = append(paths, dataJSON)
		}
	}

	return paths
}

// IconCacheReferenceCounts 扫描所有用户配置，统计每个缓存图标被引用了几次（key 为小写文件名）。
func IconCacheReferenceCounts() map[string]int {
	counts := map[string]int{}
	for _, path := range iconConfigFilePaths() {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var raw any
		if err := json.Unmarshal(data, &raw); err != nil {
			continue
		}
		collectIconCacheRefs(raw, counts)
	}
	return counts
}

// ListIconCache 列出图标缓存目录，并带上每个文件的引用次数 / 总大小 / 未引用数量。
func ListIconCache(c *gin.Context) {
	entries, err := os.ReadDir(config.IconCacheDir)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success":           true,
			"files":             []iconCacheEntry{},
			"totalSize":         0,
			"totalCount":        0,
			"unreferencedCount": 0,
		})
		return
	}

	refs := IconCacheReferenceCounts()
	files := make([]iconCacheEntry, 0, len(entries))
	var totalSize int64
	unreferenced := 0

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !isIconCacheFile(name) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		refCount := refs[strings.ToLower(name)]
		if refCount == 0 {
			unreferenced++
		}
		files = append(files, iconCacheEntry{
			Name:       name,
			Path:       iconCacheURLPrefix + name,
			Size:       info.Size(),
			ModifiedAt: info.ModTime().Unix(),
			RefCount:   refCount,
		})
		totalSize += info.Size()
	}

	// 默认按上传时间倒序（最新在前），与壁纸库一致
	sort.Slice(files, func(i, j int) bool {
		if files[i].ModifiedAt == files[j].ModifiedAt {
			return files[i].Name < files[j].Name
		}
		return files[i].ModifiedAt > files[j].ModifiedAt
	})

	c.JSON(http.StatusOK, gin.H{
		"success":           true,
		"files":             files,
		"totalSize":         totalSize,
		"totalCount":        len(files),
		"unreferencedCount": unreferenced,
	})
}

// DeleteIconCache 删除单个缓存图标。若仍在被卡片引用，除非显式 force=1，否则返回 409。
func DeleteIconCache(c *gin.Context) {
	name, ok := sanitizeIconCacheName(c.Param("name"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   gin.H{"code": "invalid_name", "message": "非法的图标文件名"},
		})
		return
	}

	force := isTruthyQuery(c.Query("force"))
	refCount := IconCacheReferenceCounts()[strings.ToLower(name)]
	if refCount > 0 && !force {
		c.JSON(http.StatusConflict, gin.H{
			"success": false,
			"error": gin.H{
				"code":     "icon_in_use",
				"message":  "该图标正在被卡片使用",
				"refCount": refCount,
			},
		})
		return
	}

	if err := os.Remove(filepath.Join(config.IconCacheDir, name)); err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{
				"success": false,
				"error":   gin.H{"code": "not_found", "message": "图标不存在"},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   gin.H{"code": "delete_failed", "message": "删除失败", "details": err.Error()},
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "name": name})
}

type iconCacheBatchDeleteRequest struct {
	Names []string `json:"names"`
	Force bool     `json:"force"`
}

// BatchDeleteIconCache 批量删除。被引用且未 force 的会进 skipped，非法的进 failed。
func BatchDeleteIconCache(c *gin.Context) {
	var req iconCacheBatchDeleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   gin.H{"code": "invalid_json", "message": "请求体格式不正确"},
		})
		return
	}

	refs := IconCacheReferenceCounts()
	deleted := []string{}
	skipped := []string{}
	failed := []string{}
	seen := map[string]bool{}

	for _, raw := range req.Names {
		name, ok := sanitizeIconCacheName(raw)
		if !ok {
			failed = append(failed, raw)
			continue
		}
		key := strings.ToLower(name)
		if seen[key] {
			continue
		}
		seen[key] = true
		if refs[key] > 0 && !req.Force {
			skipped = append(skipped, name)
			continue
		}
		if err := os.Remove(filepath.Join(config.IconCacheDir, name)); err != nil {
			// 已经不存在也当作「跳过」，不算失败
			skipped = append(skipped, name)
			continue
		}
		deleted = append(deleted, name)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"deleted": deleted,
		"skipped": skipped,
		"failed":  failed,
	})
}

// CleanupIconCache 一键清理所有「没有被任何卡片引用」的图标。
func CleanupIconCache(c *gin.Context) {
	entries, err := os.ReadDir(config.IconCacheDir)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": true, "deleted": []string{}, "freedBytes": 0})
		return
	}

	refs := IconCacheReferenceCounts()
	deleted := []string{}
	var freedBytes int64

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !isIconCacheFile(name) {
			continue
		}
		if refs[strings.ToLower(name)] > 0 {
			continue
		}
		if info, err := entry.Info(); err == nil {
			freedBytes += info.Size()
		}
		if err := os.Remove(filepath.Join(config.IconCacheDir, name)); err != nil {
			continue
		}
		deleted = append(deleted, name)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"deleted":    deleted,
		"freedBytes": freedBytes,
	})
}

func isTruthyQuery(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
