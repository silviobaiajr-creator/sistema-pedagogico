
// =================================================================================
// ARQUIVO: constants.js
// RESPONSABILIDADE: Armazenar constantes globais da aplicação para evitar
// dependências cruzadas e "números mágicos" no código.
//
// PASSO 1 DA REFATORAÇÃO:
// 1. (NOVO) Este arquivo foi criado.
// 2. (MOVIDO) A constante 'actionDisplayTitles' foi movida de 'reports.js' para cá.
// =================================================================================

/**
 * Mapeia os IDs internos das ações de Busca Ativa para títulos
 * amigáveis que serão exibidos na UI e nos relatórios.
 */
export const actionDisplayTitles = {
    tentativa_1: "1ª Tentativa de Contato",
    tentativa_2: "2ª Tentativa de Contato",
    tentativa_3: "3ª Tentativa de Contato",
    visita: "Visita In Loco",
    encaminhamento_ct: "Encaminhamento ao Conselho Tutelar",
    analise: "Análise"
};

// Futuramente, outras constantes podem ser adicionadas aqui, como:
// export const OCURRENCE_TYPES = [
//     "Agressão (Física)",
//     "Agressão (Verbal)",
//     ...
// ];
