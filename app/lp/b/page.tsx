import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

// Variante B do teste A/B da home: igual à A, mais a seção de planos e preços.
// A proxy.ts reescreve "/" para esta rota para metade dos visitantes.
export const metadata: Metadata = {
  title: "FISGA | Comentários que viram conversas",
  description:
    "Automatize respostas a comentários no Instagram, publique e agende conteúdo, acompanhe Stories e entenda o que faz seu perfil crescer.",
  alternates: { canonical: "/" },
  robots: { index: false, follow: true },
};

export default function HomeVariantBPage() {
  return <LandingPage variant="b" />;
}
