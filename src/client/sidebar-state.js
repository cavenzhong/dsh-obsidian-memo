/** 宿主侧栏折叠状态：由 sidebar.footer.action 的 wide 属性上报，主面板订阅。 */
import { React } from './react.js';

let sidebarWide = null;
const listeners = new Set();

function getSidebarWide() {
  return sidebarWide;
}

function setSidebarWide(next) {
  const value = typeof next === 'boolean' ? next : null;
  if (sidebarWide === value) return;
  sidebarWide = value;
  listeners.forEach((listener) => listener());
}

function subscribeSidebarWide(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 无视觉输出的上报组件：宿主侧栏以 wide=false 渲染折叠导轨。
 * 注册在 sidebar.footer.action 里，展开/折叠时都能收到最新值。
 */
function SidebarWideReporter(props) {
  const wide = props && typeof props.wide === 'boolean' ? props.wide : null;
  React.useEffect(() => {
    setSidebarWide(wide);
  }, [wide]);
  return null;
}

/** 主面板读取侧栏是否展开；null = 尚未收到宿主状态。 */
function useSidebarWide() {
  const [value, setValue] = React.useState(getSidebarWide);
  React.useEffect(() => {
    setValue(getSidebarWide());
    return subscribeSidebarWide(() => setValue(getSidebarWide()));
  }, []);
  return value;
}

export { SidebarWideReporter, useSidebarWide, getSidebarWide, setSidebarWide, subscribeSidebarWide };
