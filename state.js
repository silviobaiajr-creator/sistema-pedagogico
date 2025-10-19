// ARQUIVO: state.js
// RESPONSABILIDADE: Guardar o estado global da aplicação e centralizar
// as referências a todos os elementos importantes do DOM (a nossa "ponte"
// entre o JavaScript e o HTML).

export const state = {
    // Dados da aplicação
    students: [],
    occurrences: [],
    absences: [],
    
    // Estado dos filtros para OCORRÊNCIAS
    filtersOccurrences: { 
        startDate: null, 
        endDate: null,
        // NOVO: Filtros por tipo e status
        type: 'all', 
        status: 'all' 
    },
    // Estado dos filtros para BUSCA ATIVA
    filtersAbsences: { 
        processStatus: 'all', 
        pendingAction: 'all', 
        returnStatus: 'all' 
    },
    filterOccurrences: '', // Para a busca por nome de aluno
    filterAbsences: '',   // Para a busca por nome de aluno
    
    // Controlo da UI
    activeTab: 'occurrences',
    recordToDelete: null,
    // NOVO: Guarda o ID da última ocorrência salva para usar nas "Ações Rápidas"
    lastSavedOccurrenceId: null,

    // Configuração do Firebase (será preenchida pelo main.js)
    db: null,
    userId: null,
    unsubscribeOccurrences: null,
    unsubscribeAbsences: null
};

// Objeto que contém referências diretas a elementos do HTML
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
    logoutBtn: document.getElementById('logout-btn'),
    userProfile: document.getElementById('user-profile'),
    userEmail: document.getElementById('user-email'),
    
    // Abas de Navegação
    tabOccurrences: document.getElementById('tab-occurrences'),
    tabAbsences: document.getElementById('tab-absences'),
    tabContentOccurrences: document.getElementById('tab-content-occurrences'),
    tabContentAbsences: document.getElementById('tab-content-absences'),
    
    // Listas e Estados de Exibição
    occurrencesListDiv: document.getElementById('occurrences-list'),
    absencesListDiv: document.getElementById('absences-list'),
    emptyStateOccurrences: document.getElementById('empty-state-occurrences'),
    emptyStateAbsences: document.getElementById('empty-state-absences'),
    loadingOccurrences: document.getElementById('loading-occurrences'),
    loadingAbsences: document.getElementById('loading-absences'),
    occurrencesTitle: document.getElementById('occurrences-title'),

    // Formulários principais
    occurrenceForm: document.getElementById('occurrence-form'),
    absenceForm: document.getElementById('absence-form'),

    // Campos de busca
    searchOccurrences: document.getElementById('search-occurrences'),
    searchAbsences: document.getElementById('search-absences'),

    // Filtros de Ocorrências
    occurrenceStartDate: document.getElementById('occurrence-start-date'),
    occurrenceEndDate: document.getElementById('occurrence-end-date'),
    // NOVO: Referências para os novos filtros de ocorrências
    filterOccurrenceType: document.getElementById('filter-occurrence-type'),
    filterOccurrenceStatus: document.getElementById('filter-occurrence-status'),

    // Modais existentes
    occurrenceModal: document.getElementById('occurrence-modal'),
    absenceModal: document.getElementById('absence-modal'),
    studentsModal: document.getElementById('students-modal'),
    deleteConfirmModal: document.getElementById('delete-confirm-modal'),
    
    // 
    // ***************************************************************
    // ** NOVO: Referências aos novos modais do fluxo de ocorrências **
    // ***************************************************************
    //
    postSaveActionsModal: document.getElementById('post-save-actions-modal'),
    occurrenceRecordModalBackdrop: document.getElementById('occurrence-record-modal-backdrop'),
    notificationResponsibleModalBackdrop: document.getElementById('notification-responsible-modal-backdrop'),
};

