/** The page title row (report §1, `.header-nav`). */
export function PageHeader(props: { title: string }) {
  return (
    <div class="mx-(--body-gutter) pt-8">
      <h1 class="type-header-emphasized">{props.title}</h1>
    </div>
  );
}
