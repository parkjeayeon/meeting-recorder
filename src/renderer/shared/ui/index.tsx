// 공통 화면 부품. 옛 화면 코드(legacy/app.js)의 h()·icon()과 같은 마크업을 내서 CSS·시험이 그대로 맞는다.
/** SVG 묶음(index.html의 <symbol id="i-…">)의 아이콘 하나 */
export function Icon({ id }: { readonly id: string }) {
  return (
    <svg>
      <use href={`#${id}`} />
    </svg>
  );
}
