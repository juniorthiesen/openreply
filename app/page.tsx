import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: "FISGA | Comentários que viram conversas",
  description:
    "Automatize respostas a comentários no Instagram, publique e agende conteúdo, acompanhe Stories e entenda o que faz seu perfil crescer.",
  openGraph: {
    title: "FISGA | Comentários que viram conversas",
    description:
      "Campanhas de comentários para DM, agendamento de conteúdo e métricas do Instagram em um só lugar.",
    type: "website",
    locale: "pt_BR",
  },
  twitter: {
    card: "summary_large_image",
    title: "FISGA | Comentários que viram conversas",
    description:
      "Automação de campanhas e ferramentas para publicar, agendar e analisar seu Instagram.",
  },
};

export default function HomePage() {
  return <LandingPage variant="a" />;
}
