import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export const metadata = {
  title: "Verifique seu e-mail - FISGA",
  description: "Enviamos um link seguro de acesso para seu e-mail.",
};

export default function VerifyRequestPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="flex justify-center">
            <BrandLogo size={44} />
            <span className="sr-only">Fisga</span>
          </h1>
        </div>

        <div className="panel rounded p-8 text-center">
          <h2 className="text-lg font-semibold mb-2">Verifique seu e-mail</h2>
          <p className="text-sm text-muted">
            Enviamos um link seguro de acesso. Abra-o neste dispositivo para
            continuar.
          </p>
          <p className="mt-6 text-sm">
            <Link href="/login" className="text-accent hover:underline">
              Voltar para entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
