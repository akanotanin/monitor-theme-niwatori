// cyber-probe 主题：数据源固定为 Monitor（极简探针 hub）。
//
// 农场原本由一键安装器生成这份文件（探测任务名单 + 数据源）。做成主题之后不再有安装器：
//   · 数据源 = Monitor hub 的公开 API（/api/me、/api/nodes、/api/nodes/{id}/metrics）；
//   · 探测任务（网站鸡）在运行时从 /api/nodes/{id}/metrics 的 probes 里读，不再需要静态名单；
//   · 站名由 /api/me 的 site_name 注入（theme-boot.js 写进 window.CP_THEME）。
// PROBES 保留空对象：hud/npc 里仍按「缺项 = 用默认值」处理。
export const GENERATED_AT = "";
export const SOURCE = "monitor";
export const HISTORY_DAYS = 0;
export const SITE_NAME = "";
export const PROBES = {};
