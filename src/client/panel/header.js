/** 顶栏的纯渲染函数：版本、计数、日期、子目录、排序和设置入口。 */
import { CalendarIcon, FolderTreeIcon, GearIcon, SortIcon } from '../components/icons.js';
import { DATE_FILTERS, SORT_OPTIONS } from '../constants.js';
import { h } from '../react.js';
import { formatVersionLabel } from '../utils.js';

function renderPanelHeader({
  chooseDateFilter, chooseSort, dateEnabled, dateFilter, dateMenu, dateRangeLabel, dateRealtime,
  dateWrapRef, dirLabel, filteredNotes, includeSubfolders, openDateMenu, openSettings, setDateMenu,
  settingsOpen, sortId, sortMenu, sortWrapRef, subfoldersBusy, t, toggleDateEnabled, toggleDateRealtime,
  toggleSortMenu, toggleSubfolders, view,
}) {
    return h('header', { className: 'SN_head' },
      h('div', { className: 'SN_headMain' },
        h('div', { className: 'SN_titleRow' },
          h('h1', { className: 'SN_title' }, t('panel.title')),
          // 0.13：byline 只在顶栏大标题之后（h1 之后、计数之前）；版本号自动取插件实际版本。
          h('span', { className: 'SN_headByline' }, formatVersionLabel(view.version) ? 'v' + formatVersionLabel(view.version) : ''),
          view.loaded ? h('span', { className: 'SN_count' }, t('panel.count', { count: filteredNotes.length })) : null,
        ),
        dirLabel ? h('div', { className: 'SN_headPath', title: dirLabel }, dirLabel) : null,
      ),
      h('div', { className: 'SN_headActions' },
        // 0.14 日期筛选（顶栏第一个）：点击切换，悬停或方向键打开档位菜单。
        h('div', { className: 'SN_sortWrap SN_dateGroup', ref: dateWrapRef,
          onMouseEnter: openDateMenu,
          onMouseLeave: () => { if (!dateWrapRef.current?.querySelector('[role="menu"]')?.contains(document.activeElement)) setDateMenu(false); },
          onBlur: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDateMenu(false); },
        },
          h('button', {
            type: 'button',
            className: 'SN_iconBtn',
            'data-active': dateEnabled ? 'true' : 'false',
            'aria-pressed': dateEnabled ? 'true' : 'false',
            'aria-label': dateEnabled
              ? t('date.toggleOn', { range: dateRangeLabel })
              : t('date.toggleOff', { range: dateRangeLabel }),
            title: dateEnabled
              ? t('date.toggleOn', { range: dateRangeLabel })
              : t('date.toggleOff', { range: dateRangeLabel }),
            'aria-haspopup': 'menu',
            'aria-expanded': dateMenu ? 'true' : 'false',
            onKeyDown: (event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault(); openDateMenu();
                requestAnimationFrame(() => dateWrapRef.current?.querySelector('[role="menuitemradio"]')?.focus());
              }
            },
            onContextMenu: (event) => { event.preventDefault(); openDateMenu(); },
            onClick: toggleDateEnabled,
          }, h(CalendarIcon, null)),
          dateMenu ? h('div', {
            className: 'SN_sortMenu',
            role: 'menu',
            'aria-label': t('date.label'),
          },
            DATE_FILTERS.map((option) => {
              // 开关熄灭时菜单里不显示勾选（选任意档位会自动点亮）。
              const current = dateEnabled && option.id === dateFilter;
              return h('button', {
                key: option.id,
                type: 'button',
                className: 'SN_sortItem',
                role: 'menuitemradio',
                'aria-checked': current ? 'true' : 'false',
                'data-active': current ? 'true' : 'false',
                onClick: () => chooseDateFilter(option.id),
              },
                h('span', { className: 'SN_sortCheck', 'aria-hidden': 'true' }, current ? '✓' : ''),
                h('span', null, t(option.labelKey)),
              );
            }),
            h('div', { className: 'SN_menuDivider', 'aria-hidden': 'true' }),
            h('button', {
              type: 'button',
              className: 'SN_dateItem',
              role: 'menuitemcheckbox',
              'aria-checked': dateRealtime ? 'true' : 'false',
              onClick: toggleDateRealtime,
            },
              h('span', {
                className: 'SN_checkBox',
                'data-checked': dateRealtime ? 'true' : 'false',
                'aria-hidden': 'true',
              }, dateRealtime ? '✓' : ''),
              h('span', { className: 'SN_dateItemMain' },
                h('span', { className: 'SN_dateItemLabel' }, t('date.realtime')),
                h('span', { className: 'SN_dateItemHint' }, t('date.realtimeHint')),
              ),
            ),
          ) : null,
        ),
        // 0.13 子文件夹开关（§7.1）：日期筛选右侧；aria-pressed 反映 settings.includeSubfolders。
        h('button', {
          type: 'button',
          className: 'SN_iconBtn',
          'data-active': includeSubfolders ? 'true' : 'false',
          'aria-pressed': includeSubfolders ? 'true' : 'false',
          'aria-label': includeSubfolders ? t('panel.subfolders') : t('panel.topOnly'),
          title: includeSubfolders ? t('panel.subfolders') : t('panel.topOnly'),
          disabled: !view.loaded || subfoldersBusy,
          onClick: toggleSubfolders,
        }, h(FolderTreeIcon, null)),
        h('div', { className: 'SN_sortWrap', ref: sortWrapRef },
          h('button', {
            type: 'button',
            className: 'SN_iconBtn',
            'data-active': sortMenu ? 'true' : 'false',
            'aria-haspopup': 'menu',
            'aria-expanded': sortMenu ? 'true' : 'false',
            'aria-label': t('sort.label'),
            title: t('sort.label'),
            onClick: toggleSortMenu,
          }, h(SortIcon, null)),
          sortMenu ? h('div', {
            className: 'SN_sortMenu',
            role: 'menu',
            'aria-label': t('sort.label'),
          },
            SORT_OPTIONS.map((option) => h('button', {
              key: option.id,
              type: 'button',
              className: 'SN_sortItem',
              role: 'menuitemradio',
              'aria-checked': option.id === sortId ? 'true' : 'false',
              'data-active': option.id === sortId ? 'true' : 'false',
              onClick: () => chooseSort(option.id),
            },
              h('span', { className: 'SN_sortCheck', 'aria-hidden': 'true' }, option.id === sortId ? '✓' : ''),
              h('span', null, t(option.labelKey)),
            )),
          ) : null,
        ),
        h('button', {
          type: 'button',
          className: 'SN_iconBtn',
          'data-active': settingsOpen ? 'true' : 'false',
          onClick: openSettings,
          'aria-label': t('panel.settings'),
          title: t('panel.settings'),
        }, h(GearIcon, null)),
      ),
    );
  }

export { renderPanelHeader };
