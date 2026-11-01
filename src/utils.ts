/**
 * Smoothly scrolls a tab or sub-tab button into view inside its horizontal scroll container
 * so that if it is partially or completely cut off on mobile screens, it automatically scrolls
 * to become fully and comfortably visible, without causing vertical window jumping.
 */
export function scrollTabIntoView(
  container: HTMLElement | null,
  targetElement: HTMLElement | null,
  behavior: ScrollBehavior = 'smooth'
) {
  if (!container || !targetElement) return;

  const containerRect = container.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();

  // Edge buffer in pixels to detect if the element is clipped or touching container edges
  const buffer = 16;
  const isClippedLeft = targetRect.left < containerRect.left + buffer;
  const isClippedRight = targetRect.right > containerRect.right - buffer;

  // If partially clipped on left/right or outside the visible container area
  if (isClippedLeft || isClippedRight) {
    const targetLeftRel = targetRect.left - containerRect.left + container.scrollLeft;
    const targetScrollLeft = targetLeftRel - (container.clientWidth / 2) + (targetElement.clientWidth / 2);

    container.scrollTo({
      left: Math.max(0, targetScrollLeft),
      behavior,
    });
  }
}

