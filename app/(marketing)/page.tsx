import { FAQSection } from "@/components/marketing/FAQSection";
import { FinalCTA } from "@/components/marketing/FinalCTA";
import { Hero } from "@/components/marketing/Hero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { ProblemSection } from "@/components/marketing/ProblemSection";
import { SampleFix } from "@/components/marketing/SampleFix";
import { TrustSection } from "@/components/marketing/TrustSection";
import { ValueProps } from "@/components/marketing/ValueProps";
import { WhoItsFor } from "@/components/marketing/WhoItsFor";

export default function HomePage() {
  return (
    <>
      <Hero />
      <ProblemSection />
      <HowItWorks />
      <ValueProps />
      <SampleFix />
      <TrustSection />
      <WhoItsFor />
      <FAQSection />
      <FinalCTA />
    </>
  );
}
