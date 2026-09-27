package handlers

import "testing"

func TestBuildIPLocation(t *testing.T) {
	cases := []struct {
		name string
		info *IPInfo
		want string
	}{
		{
			name: "常规三级",
			info: &IPInfo{Country: "中国", Region: "江苏", City: "南京"},
			want: "中国 江苏 南京",
		},
		{
			name: "相邻重复只留一个（ip-api 中文的 regionName 常等于 city）",
			info: &IPInfo{Country: "台湾", Region: "新竹市", City: "新竹市"},
			want: "台湾 新竹市",
		},
		{
			name: "子串也算重复（ipwhois 中文给的是「臺北市」+「臺北」）",
			info: &IPInfo{Country: "台湾", Region: "臺北市", City: "臺北"},
			want: "台湾 臺北市",
		},
		{
			name: "省与市不构成子串时都要保留",
			info: &IPInfo{Country: "中国", Region: "江苏省", City: "南京市"},
			want: "中国 江苏省 南京市",
		},
		{
			name: "ISP 不参与拼接（否则出来就是中英混排）",
			info: &IPInfo{Country: "中国", Region: "江苏", City: "南京", Isp: "Chunghwa Telecom Co., Ltd."},
			want: "中国 江苏 南京",
		},
		{
			name: "缺国家",
			info: &IPInfo{Region: "江苏", City: "南京"},
			want: "江苏 南京",
		},
		{
			name: "只有城市",
			info: &IPInfo{City: "南京"},
			want: "南京",
		},
		{
			name: "空白片段被忽略",
			info: &IPInfo{Country: "  ", Region: "", City: "南京"},
			want: "南京",
		},
		{
			name: "全空",
			info: &IPInfo{},
			want: "",
		},
		{
			name: "兜底数据源的英文原样保留（不做翻译）",
			info: &IPInfo{Country: "China", Region: "Jiangsu Sheng", City: "Nanjing"},
			want: "China Jiangsu Sheng Nanjing",
		},
		{
			name: "nil 不 panic",
			info: nil,
			want: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := buildIPLocation(tc.info); got != tc.want {
				t.Fatalf("buildIPLocation() = %q, want %q", got, tc.want)
			}
		})
	}
}
