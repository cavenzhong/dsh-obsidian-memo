/**
 * 卡片淡色板：Host 按 tag 稳定分配，Client 也用它作为工作空间纸色。
 * dot 是选择用的饱和小圆点；light/dark 是卡片与阅读抽屉的纸色。
 */
const NOTE_PAPER_COLORS = Object.freeze([
  { id: 'paper', name: '纸白', color: '#FDFAF4', dark: '#2C2721', dot: '#CAC2B3' },
  { id: 'moss', name: '苔绿', color: '#F5F9F4', dark: '#232B24', dot: '#8FBD9F' },
  { id: 'apricot', name: '杏', color: '#FDF7F3', dark: '#2E2622', dot: '#E5B08C' },
  { id: 'mist', name: '雾蓝', color: '#F4F8FC', dark: '#222A33', dot: '#92B6D9' },
  { id: 'lilac', name: '藕荷', color: '#FAF5FA', dark: '#2A242C', dot: '#C0A5CB' },
  { id: 'sand', name: '米', color: '#FAF8F2', dark: '#2B2822', dot: '#D8C395' },
  { id: 'rouge', name: '胭脂', color: '#FDF5F6', dark: '#2E2426', dot: '#DE9AA3' },
  { id: 'celadon', name: '青瓷', color: '#F5F9F7', dark: '#222C29', dot: '#8FBAB0' },
]);

export { NOTE_PAPER_COLORS };
