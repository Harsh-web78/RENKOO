import { Accordion, AccordionItem } from "@/components/ui/Accordion";
import { Container } from "@/components/ui/Container";

const faqs: AccordionItem[] = [
  {
    question: "What does RENKO actually do?",
    answer:
      "RENKO connects to your Google Search Console data and identifies the single highest-value change worth making next on your site, with the evidence behind it.",
  },
  {
    question: "Does RENKO make changes to my website?",
    answer:
      "No. RENKO is read-only. It recommends a change and you decide whether and how to make it, wherever your site actually lives.",
  },
  {
    question: "Why does RENKO need Search Console?",
    answer:
      "Search Console is the most direct record of how your pages actually perform in Google search — impressions, clicks, position, and CTR. RENKO's recommendations come directly from that data.",
  },
  {
    question: "How long does the first analysis take?",
    answer:
      "Most first analyses complete within a few minutes. It depends on how much history your property has in Search Console.",
  },
  {
    question: "How does RENKO choose the next fix?",
    answer:
      "RENKO compares each page and query against its own recent history to find where something meaningful has changed, then ranks candidate opportunities by how much they're likely to matter.",
  },
  {
    question: "Can I use RENKO for client websites?",
    answer:
      "Yes. Agencies can connect multiple client properties, each analyzed and tracked separately under the same workspace.",
  },
  {
    question: "Does RENKO replace Ahrefs or Semrush?",
    answer:
      "No, and it isn't trying to. Those tools are built for research across keywords, backlinks, and competitors. RENKO answers a narrower question — what should you work on next — using the data you already have in Search Console.",
  },
  {
    question: "What happens when there isn't enough data?",
    answer:
      "RENKO says so directly rather than guessing. If a property doesn't have enough traffic or history yet for a reliable recommendation, RENKO explains what's needed and checks again once more data is available.",
  },
];

export function FAQSection() {
  return (
    <section className="border-b border-line py-16 md:py-24">
      <Container>
        <h2 className="font-serif text-h1 text-ink md:text-editorial-h1">Frequently asked questions</h2>
        <div className="mt-10">
          <Accordion items={faqs} />
        </div>
      </Container>
    </section>
  );
}
