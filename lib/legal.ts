/**
 * Who answers for the service on the legal pages. Meta's App Review and the
 * LGPD both expect a named controller and a reachable contact, so every legal
 * page reads them from here instead of repeating them.
 */
export const LEGAL = {
  brand: "Fisga",
  /** Razão social de quem opera o serviço. */
  legalName: "ADSMENTOR MARKETING LTDA",
  /** CNPJ (ou CPF, se for pessoa física). */
  document: "CNPJ 50.387.258/0001-60",
  /** Endereço que recebe pedidos de privacidade e exclusão de dados. */
  contactEmail: "contato@adsmentor.com.br",
  /** Cidade e estado, para o foro dos termos. */
  city: "Itajaí/SC",
  updatedAt: "7 de outubro de 2026",
} as const;
