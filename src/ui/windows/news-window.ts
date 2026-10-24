import { element } from '../dom';
import { formatDate } from '../format';
import type { NewsItem } from '../news';
import type { UiContext, WindowController } from '../ui-types';

/** Message history; tapping a message with a location jumps there. */
export function openNewsWindow(
  ctx: UiContext,
  history: () => readonly NewsItem[],
  follow: (item: NewsItem) => void,
): WindowController {
  const { window: win } = ctx.windows.open({
    id: 'news',
    title: 'Recent messages',
    kind: 'park',
    width: 340,
  });
  const list = element('ul', 'ride-list');
  list.setAttribute('aria-label', 'Recent messages');
  win.pane().append(list);
  let shown = -1;
  return {
    update() {
      const items = history();
      const latest = items[0]?.id ?? 0;
      if (latest === shown) return;
      shown = latest;
      if (items.length === 0) {
        list.replaceChildren(element('li', 'ui-help', 'No messages yet.'));
        return;
      }
      list.replaceChildren(
        ...items.map((item) => {
          const row = element('li');
          const b = element('button', 'list-row');
          b.type = 'button';
          b.append(
            element('span', 'list-name', item.text),
            element('span', 'list-meta', formatDate(item.tick)),
          );
          b.disabled = !item.target;
          b.addEventListener('click', () => follow(item));
          row.append(b);
          return row;
        }),
      );
    },
  };
}
