// =================================================================================
// ARQUIVO: state.js

export const state = {
    // Dados carregados do Firestore
    students: [],
    occurrences: [],
    absences: [],
    
    // Configurações da escola
    config: {
        schoolName: "Carregando...",
        city: "",
        schoolLogoUrl: null,
        adminEmails: [] // (ADICIONADO - Híbrida Admin)
    },

    // (NOVO - V2.1) Controle de Paginação de Alunos
    pagination: {
        lastVisible: null, // O cursor do Firestore para a próxima página
        hasMore: true,     // Se falso, esconde o botão "Carregar Mais"
        isLoading: false   // Bloqueia múltiplos cliques
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
        returnStatus: 'all',
        // --- NOVO (Sugestão 1): Filtros de Data para Busca Ativa ---
        startDate: null, 
        endDate: null    
        // --- FIM NOVO ---
    },
    
    // Controle de estado da UI
    activeTab: 'occurrences',
    recordToDelete: null,
    selectedStudents: new Map(), // Gerencia os alunos selecionados no modal de ocorrência

    // Estado de autenticação e conexão
    db: null,
    userId: null,
    userEmail: null,
    isAdmin: false, // (ADICIONADO - Híbrida Admin)
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
    // (NOVO - REQUISIÇÃO 2) Referência para o modal de fluxo de busca ativa
    dom.absenceSearchFlowModal = document.getElementById('absence-search-flow-modal'); 
    dom.studentsModal = document.getElementById('students-modal');
    dom.settingsModal = document.getElementById('settings-modal'); 
    dom.notificationModalBackdrop = document.getElementById('notification-modal-backdrop');
    dom.deleteConfirmModal = document.getElementById('delete-confirm-modal');
    dom.reportGeneratorModal = document.getElementById('report-generator-modal');
    dom.reportViewModalBackdrop = document.getElementById('report-view-modal-backdrop');
    dom.fichaViewModalBackdrop = document.getElementById('ficha-view-modal-backdrop');
    dom.followUpModal = document.getElementById('follow-up-modal');
    dom.sendOccurrenceCtModal = document.getElementById('send-occurrence-ct-modal'); 
    dom.sendOccurrenceCtForm = document.getElementById('send-occurrence-ct-form');
    dom.sendCtStudentSelect = document.getElementById('send-ct-student-select');
    dom.sendCtOficioNumberInput = document.getElementById('send-ct-oficio-number');
    
    // Listas e estados de carregamento
    dom.occurrencesListDiv = document.getElementById('occurrences-list');
    dom.absencesListDiv = document.getElementById('absences-list');
    dom.emptyStateOccurrences = document.getElementById('empty-state-occurrences');
    dom.emptyStateAbsences = document.getElementById('empty-state-absences');
    dom.loadingOccurrences = document.getElementById('loading-occurrences');
    dom.loadingAbsences = document.getElementById('loading-absences');
    dom.studentsListTable = document.getElementById('students-list-table');
    
    // Formulários
    dom.occurrenceForm = document.getElementById('occurrence-form');
    dom.absenceForm = document.getElementById('absence-form');
    dom.settingsForm = document.getElementById('settings-form'); 
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
    dom.manageStudentsBtn = document.getElementById('manage-students-btn'); 
    dom.generalReportBtn = document.getElementById('general-report-btn');
    dom.generalBaReportBtn = document.getElementById('general-ba-report-btn');
    dom.addAbsenceBtn = document.getElementById('add-absence-btn'); 

    // --- CORREÇÃO CSV: Adicionando referências do modal de alunos ---
    dom.studentForm = document.getElementById('student-form');
    dom.cancelEditStudentBtn = document.getElementById('cancel-edit-student-btn');
    dom.csvFile = document.getElementById('csv-file');
    dom.uploadCsvBtn = document.getElementById('upload-csv-btn');
    dom.csvFeedback = document.getElementById('csv-feedback');
    // --- Fim da Correção ---
};