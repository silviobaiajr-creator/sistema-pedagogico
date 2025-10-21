// =================================================================================
// ARQUIVO: state.js
// RESPONSABILIDADE: Guardar o estado global da aplicação e as referências
// aos elementos do DOM para acesso rápido.
// ATUALIZAÇÃO GERAL (Conforme Análise):
// 1. (Item 5) Adicionado o objeto `config` ao estado para armazenar as
//    configurações da escola (nome, logo) carregadas do Firestore.
// 2. Adicionadas referências do DOM para os novos elementos da interface, como
//    o botão de configurações e o de relatório da Busca Ativa.
// 3. (Problema 3) Adicionadas referências para o novo modal de configurações.
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
    settingsModal: document.getElementById('settings-modal'), // ATUALIZADO (Problema 3)
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
    
    // Formulários
    occurrenceForm: document.getElementById('occurrence-form'),
    absenceForm: document.getElementById('absence-form'),
    settingsForm: document.getElementById('settings-form'), // ATUALIZADO (Problema 3)
    
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
