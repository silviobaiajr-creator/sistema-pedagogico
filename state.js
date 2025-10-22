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
// 4. (Item 2) Adicionadas referências para o novo modal de Acompanhamento.
// 5. (Item 3a) Adicionada referência para a tabela de alunos (otimização).
// 6. (CORREÇÃO GERAL) Movida a atribuição do DOM para uma função
//    `initializeDOMReferences` para evitar erros de timing no carregamento.
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

// ATUALIZADO: (CORREÇÃO) Declarado vazio.
// Será populado pela função initializeDOMReferences() no main.js
// após o DOM estar completamente carregado.
export const dom = {};

// NOVO: (CORREÇÃO) Esta função popula o objeto 'dom'
export const initializeDOMReferences = () => {
    // Telas principais
    dom.loginScreen = document.getElementById('login-screen');
    dom.mainContent = document.getElementById('main-content');
    
    // Autenticação
    dom.loginView = document.getElementById('login-view');
    dom.registerView = document.getElementById('register-view');
    dom.showRegisterViewBtn = document.getElementById('show-register-view');
    dom.showLoginViewBtn = document.getElementById('show-login-view');
    dom.loginForm = document.getElementById('login-form');
    dom.registerForm = document.getElementById('register-form');
    
    // Cabeçalho e Perfil
    dom.headerSchoolName = document.getElementById('header-school-name');
    dom.logoutBtn = document.getElementById('logout-btn');
    dom.userProfile = document.getElementById('user-profile');
    dom.userEmail = document.getElementById('user-email');
    
    // Modais
    dom.occurrenceModal = document.getElementById('occurrence-modal');
    dom.absenceModal = document.getElementById('absence-modal');
    dom.studentsModal = document.getElementById('students-modal');
    dom.settingsModal = document.getElementById('settings-modal'); 
    dom.notificationModalBackdrop = document.getElementById('notification-modal-backdrop');
    dom.deleteConfirmModal = document.getElementById('delete-confirm-modal');
    dom.reportGeneratorModal = document.getElementById('report-generator-modal');
    dom.reportViewModalBackdrop = document.getElementById('report-view-modal-backdrop');
    dom.fichaViewModalBackdrop = document.getElementById('ficha-view-modal-backdrop');
    // NOVO: (Arquitetura Item 2) Referência para o novo modal
    dom.followUpModal = document.getElementById('follow-up-modal');
    
    // Listas e estados de carregamento
    dom.occurrencesListDiv = document.getElementById('occurrences-list');
    dom.absencesListDiv = document.getElementById('absences-list');
    dom.emptyStateOccurrences = document.getElementById('empty-state-occurrences');
    dom.emptyStateAbsences = document.getElementById('empty-state-absences');
    dom.loadingOccurrences = document.getElementById('loading-occurrences');
    dom.loadingAbsences = document.getElementById('loading-absences');
    // NOVO: (Otimização Item 3a) Referência para a tabela de alunos
    dom.studentsListTable = document.getElementById('students-list-table');
    
    // Formulários
    dom.occurrenceForm = document.getElementById('occurrence-form');
    dom.absenceForm = document.getElementById('absence-form');
    dom.settingsForm = document.getElementById('settings-form'); 
    // NOVO: (Arquitetura Item 2) Referência para o novo formulário
    dom.followUpForm = document.getElementById('follow-up-form');
    
    // Navegação e Filtros
    dom.tabOccurrences = document.getElementById('tab-occurrences');
    dom.tabAbsences = document.getElementById('tab-absences');
    dom.tabContentOccurrences = document.getElementById('tab-content-occurrences');
    dom.tabContentAbsences = document.getElementById('tab-content-absences');
    dom.searchOccurrences = document.getElementById('search-occurrences');
    dom.searchAbsences = document.getElementById('search-absences');
    dom.occurrencesTitle = document.getElementById('occurrences-title');
    dom.occurrenceStartDate = document.getElementById('occurrence-start-date');
    dom.occurrenceEndDate = document.getElementById('occurrence-end-date');

    // Botões de Ação Principais
    dom.settingsBtn = document.getElementById('settings-btn');
    dom.generalReportBtn = document.getElementById('general-report-btn');
    dom.generalBaReportBtn = document.getElementById('general-ba-report-btn');
};

