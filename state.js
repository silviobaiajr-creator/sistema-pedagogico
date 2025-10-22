// =================================================================================
// ARQUIVO: state.js
// RESPONSABILIDADE: Guardar o estado global da aplicação e as referências
// aos elementos do DOM para acesso rápido.
// ATUALIZAÇÃO GERAL (Conforme Análise):
// 1. (Item 2 - Arquitetura) Adicionadas referências DOM para o novo modal
//    de "Acompanhamento Individual" (`followUpModal` e `followUpForm`).
// 2. (Item 3a - Otimização) Adicionada referência DOM para a tabela de
//    alunos (`studentsListTable`) para permitir a delegação de eventos.
// =================================================================================

export const state = {
    // Dados carregados do Firestore
    students: [],
    occurrences: [],
    absences: [],
    
    // Configurações da escola
    config: {
        schoolName: "Carregando...",
        city: "",
        schoolLogoUrl: null
    },

    // Filtros para a aba de Ocorrências
    filterOccurrences: '', // Filtro de busca por nome de aluno
    filtersOccurrences: {
        startDate: null,
        endDate: null,
        type: 'all', 
        status: 'all'
    },
    
    // Filtros para a aba de Busca Ativa
    filterAbsences: '',
    filtersAbsences: {
        processStatus: 'all',
        pendingAction: 'all',
        returnStatus: 'all'
    },
    
    // Controle de estado da UI
    activeTab: 'occurrences',
    recordToDelete: null,
    selectedStudents: new Map(), // Gerencia os alunos selecionados no modal de ocorrência

    // Estado de autenticação e conexão
    db: null,
    userId: null,
    userEmail: null,
    unsubscribeOccurrences: null,
    unsubscribeAbsences: null,
};

// Referências aos elementos do DOM para evitar buscas repetidas no documento
export const dom = {
    // Telas principais
    loginScreen: document.getElementById('login-screen'),
    mainContent: document.getElementById('main-content'),
    
    // Autenticação
    loginView: document.getElementById('login-view'),
    registerView: document.getElementById('register-view'),
    showRegisterViewBtn: document.getElementById('show-register-view'),
    showLoginViewBtn: document.getElementById('show-login-view'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    
    // Cabeçalho e Perfil
    headerSchoolName: document.getElementById('header-school-name'),
    logoutBtn: document.getElementById('logout-btn'),
    userProfile: document.getElementById('user-profile'),
    userEmail: document.getElementById('user-email'),
    
    // Modais
    occurrenceModal: document.getElementById('occurrence-modal'),
    absenceModal: document.getElementById('absence-modal'),
    studentsModal: document.getElementById('students-modal'),
    settingsModal: document.getElementById('settings-modal'),
    // NOVO: (Arquitetura) Referência ao novo modal de acompanhamento.
    followUpModal: document.getElementById('follow-up-modal'),
    notificationModalBackdrop: document.getElementById('notification-modal-backdrop'),
    deleteConfirmModal: document.getElementById('delete-confirm-modal'),
    reportGeneratorModal: document.getElementById('report-generator-modal'),
    reportViewModalBackdrop: document.getElementById('report-view-modal-backdrop'),
    fichaViewModalBackdrop: document.getElementById('ficha-view-modal-backdrop'),
    
    // Listas e estados de carregamento
    occurrencesListDiv: document.getElementById('occurrences-list'),
    absencesListDiv: document.getElementById('absences-list'),
    emptyStateOccurrences: document.getElementById('empty-state-occurrences'),
    emptyStateAbsences: document.getElementById('empty-state-absences'),
    loadingOccurrences: document.getElementById('loading-occurrences'),
    loadingAbsences: document.getElementById('loading-absences'),
    // NOVO: (Otimização) Referência à tabela de alunos.
    studentsListTable: document.getElementById('students-list-table'),
    
    // Formulários
    occurrenceForm: document.getElementById('occurrence-form'),
    absenceForm: document.getElementById('absence-form'),
    settingsForm: document.getElementById('settings-form'),
    // NOVO: (Arquitetura) Referência ao novo formulário de acompanhamento.
    followUpForm: document.getElementById('follow-up-form'),
    
    // Navegação e Filtros
    tabOccurrences: document.getElementById('tab-occurrences'),
    tabAbsences: document.getElementById('tab-absences'),
    tabContentOccurrences: document.getElementById('tab-content-occurrences'),
    tabContentAbsences: document.getElementById('tab-content-absences'),
    searchOccurrences: document.getElementById('search-occurrences'),
    searchAbsences: document.getElementById('search-absences'),
    occurrencesTitle: document.getElementById('occurrences-title'),
    occurrenceStartDate: document.getElementById('occurrence-start-date'),
    occurrenceEndDate: document.getElementById('occurrence-end-date'),

    // Botões de Ação Principais
    settingsBtn: document.getElementById('settings-btn'),
    generalReportBtn: document.getElementById('general-report-btn'),
    generalBaReportBtn: document.getElementById('general-ba-report-btn'),
};
