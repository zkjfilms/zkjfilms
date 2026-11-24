// Renders one or more JSON-LD objects. `<` is escaped so a value containing
// "</script>" can't break out of the tag.
export default function JsonLd({ data }: { data: object | (object | null)[] | null }) {
  const items = (Array.isArray(data) ? data : [data]).filter((d): d is object => d !== null);
  return (
    <>
      {items.map((d, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, "\\u003c") }}
        />
      ))}
    </>
  );
}
