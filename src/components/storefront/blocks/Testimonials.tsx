import { Card, CardContent } from '@/components/ui/card';

export type TestimonialsProps = {
  heading?: string;
  items: { quote: string; name: string; role?: string }[];
};

/** Testimonials block: a responsive grid of customer quotes. */
export function Testimonials({ heading, items }: TestimonialsProps) {
  return (
    <section className="container py-12">
      {heading ? (
        <h2 className="mb-6 text-center font-serif text-2xl font-semibold tracking-tight">
          {heading}
        </h2>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <Card key={i} className="bg-brand/5">
            <CardContent className="flex h-full flex-col gap-4 p-6">
              <blockquote className="flex-1 text-sm leading-relaxed text-foreground/90">
                &ldquo;{item.quote}&rdquo;
              </blockquote>
              <footer className="text-sm">
                <span className="font-medium">{item.name}</span>
                {item.role ? (
                  <span className="text-muted-foreground"> · {item.role}</span>
                ) : null}
              </footer>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
