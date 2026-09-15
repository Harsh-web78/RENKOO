import type { Metadata } from "next";
import { Accordion, AccordionItem } from "@/components/ui/Accordion";
import { Container } from "@/components/ui/Container";
import { PricingInteractive } from "@/components/pricing/PricingInteractive";
import { pricingPlans } from "@/lib/pricing-config";
import { siteConfig } from "@/lib/site-config";

const pricingFaqs: AccordionItem[] = [
  {
    question: "What counts as a property?",
    answer:
      "One verified property in Google Search Console — typically one domain or subdomain you or a client owns.",
  },
  {
    question: "Can I switch plans later?",
    answer: "Yes. You can move between Solo and Agency at any time as the number of properties you manage changes.",
  },
  {
    question: "Is there a free trial?",
    answer:
      "Yes. Every plan starts with a trial period so you can see a real recommendation for your own property before paying.",
  },
  {
    question: "Do prices include tax?",
    answer: "Displayed prices are pre-tax. Any applicable tax is calculated at checkout based on your billing details.",
  },
];

export const metadata: Metadata = {
  title: "Pricing",
  description: `Simple, plan-based pricing for ${siteConfig.name}. Two plans, no complicated comparison table.`,
  alternates: {
    canonical: "/pricing",
  },
};

export default function PricingPage() {
  return (
    <div className="py-16 md:py-24">
      <Container width="page">
        <div className="max-w-editorial">
          <h1 className="font-serif text-h1 text-ink md:text-editorial-h1">Simple, plan-based pricing</h1>
          <p className="mt-6 text-body-lg text-ink-muted">
            Two plans, based on how many properties you&apos;re working on — not a feature matrix to
            decode. Every plan includes the full RENKO workflow: one recommendation, real evidence,
            and measured results.
          </p>
        </div>

        <div className="mt-12">
          <PricingInteractive plans={pricingPlans} />
        </div>

        <div className="mt-20 max-w-content">
          <h2 className="text-h2 font-semibold text-ink">Pricing questions</h2>
          <div className="mt-6">
            <Accordion items={pricingFaqs} />
          </div>
        </div>
      </Container>
    </div>
  );
}
