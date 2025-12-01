
// =================================================================================
// ARQUIVO: dashboard.js
// VERSÃO: 2.0 (Com Alertas Urgentes e Métricas Contextuais)

import { getDashboardStats } from './firestore.js';
import { dom, state } from './state.js';
import { formatDate } from './utils.js';

let chartTypes = null;
let chartStatus = null;

export const initDashboard = async () => {
    // Estado de Loading
    const loadingIcon = '<i class="fas fa-spinner fa-spin text-sm"></i>';
    document.getElementById('dash-total-students').innerHTML = loadingIcon;
    document.getElementById('dash-total-occurrences').innerHTML = loadingIcon;
    document.getElementById('dash-active-absences').innerHTML = loadingIcon;
    
    // Limpa alertas anteriores
    const alertContainer = document.getElementById('urgent-alerts-container');
    if(alertContainer) alertContainer.remove();

    const stats = await getDashboardStats();

    if (!stats) {
        document.getElementById('dash-total-students').textContent = 'Erro';
        return;
    }

    // 1. Atualiza Cards Principais com Contexto
    
    // Alunos
    animateValue('dash-total-students', 0, stats.totalStudents, 800);

    // Ocorrências (Incidência Aproximada)
    animateValue('dash-total-occurrences', 0, stats.totalOccurrences, 800);
    const incidentRate = stats.totalStudents > 0 
        ? ((stats.totalOccurrences / stats.totalStudents) * 100).toFixed(1) 
        : 0;
    
    const occCard = document.getElementById('dash-total-occurrences').parentElement;
    // Remove texto antigo se existir
    const oldOccContext = occCard.querySelector('.context-stat');
    if (oldOccContext) oldOccContext.remove();
    
    const occContextHtml = `<p class="context-stat text-xs text-yellow-600 mt-1 font-medium"><i class="fas fa-chart-line"></i> ~${incidentRate}% de incidência</p>`;
    occCard.insertAdjacentHTML('beforeend', occContextHtml);

    // Busca Ativa (Taxa de Sucesso)
    animateValue('dash-active-absences', 0, stats.totalAbsences, 800);
    const successRate = stats.totalAbsences > 0
        ? ((stats.concludedAbsences / stats.totalAbsences) * 100).toFixed(1)
        : 0;
        
    const absCard = document.getElementById('dash-active-absences').parentElement;
    const oldAbsContext = absCard.querySelector('.context-stat');
    if (oldAbsContext) oldAbsContext.remove();

    const absContextHtml = `<p class="context-stat text-xs text-emerald-600 mt-1 font-medium"><i class="fas fa-check-circle"></i> ${successRate}% resolvidos</p>`;
    absCard.insertAdjacentHTML('beforeend', absContextHtml);


    // 2. Renderiza Alertas Urgentes
    renderUrgentAlerts();

    // 3. Renderiza Gráficos
    renderCharts(stats.chartDataOccurrences, stats.chartDataAbsences);
};

const renderUrgentAlerts = () => {
    // Filtra ocorrências pendentes antigas (> 7 dias)
    const today = new Date();
    const urgentOccurrences = state.occurrences
        .filter(o => o.statusIndividual !== 'Resolvido' && o.statusIndividual !== 'Finalizada')
        .filter(o => {
            const date = new Date(o.date);
            const diffTime = Math.abs(today - date);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays > 7;
        })
        .slice(0, 3); // Top 3

    // Filtra busca ativa parada (> 5 dias sem update)
    const urgentAbsences = state.absences
        .filter(a => a.actionType !== 'analise') // Em aberto
        .filter(a => {
            const date = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date();
            const diffTime = Math.abs(today - date);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays > 5;
        })
        .slice(0, 3);

    if (urgentOccurrences.length === 0 && urgentAbsences.length === 0) return;

    // Cria Container de Alertas
    const dashboardContainer = document.getElementById('tab-content-dashboard');
    const existingContainer = document.getElementById('urgent-alerts-container');
    if(existingContainer) existingContainer.remove();

    const alertSection = document.createElement('div');
    alertSection.id = 'urgent-alerts-container';
    alertSection.className = 'mb-8 bg-red-50 border border-red-200 rounded-lg p-4';
    
    let alertsHtml = `<h3 class="text-sm font-bold text-red-800 uppercase mb-3"><i class="fas fa-bell animate-pulse mr-2"></i> Atenção Necessária</h3><div class="grid grid-cols-1 md:grid-cols-2 gap-4">`;

    if (urgentOccurrences.length > 0) {
        alertsHtml += `
            <div>
                <h4 class="text-xs font-semibold text-red-700 mb-2">Ocorrências Pendentes (+7 dias)</h4>
                <ul class="space-y-2">
                    ${urgentOccurrences.map(o => `
                        <li class="bg-white p-2 rounded border border-red-100 shadow-sm text-xs flex justify-between items-center cursor-pointer hover:bg-red-50" onclick="document.getElementById('card-nav-occurrences').click()">
                            <span><strong>${o.studentName}</strong>: ${o.statusIndividual}</span>
                            <span class="text-gray-400">${formatDate(o.date)}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>`;
    }

    if (urgentAbsences.length > 0) {
        alertsHtml += `
            <div>
                <h4 class="text-xs font-semibold text-red-700 mb-2">Busca Ativa Parada (+5 dias)</h4>
                <ul class="space-y-2">
                    ${urgentAbsences.map(a => {
                         const date = a.createdAt?.toDate ? a.createdAt.toDate() : new Date();
                         return `
                        <li class="bg-white p-2 rounded border border-red-100 shadow-sm text-xs flex justify-between items-center cursor-pointer hover:bg-red-50" onclick="document.getElementById('card-nav-absences').click()">
                            <span><strong>${a.studentName || 'Aluno'}</strong>: Aguardando ação</span>
                            <span class="text-gray-400">${formatDate(date)}</span>
                        </li>
                    `}).join('')}
                </ul>
            </div>`;
    }
    
    alertsHtml += `</div>`;
    alertSection.innerHTML = alertsHtml;
    
    // Insere logo após os cards principais
    const cardsRow = document.querySelector('#tab-content-dashboard > .grid:first-child');
    if(cardsRow) cardsRow.parentNode.insertBefore(alertSection, cardsRow.nextSibling);
}

const animateValue = (id, start, end, duration) => {
    const obj = document.getElementById(id);
    if(!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
};

const renderCharts = (occurrences, absences) => {
    // Gráfico 1: Tipos de Ocorrência (Top 5)
    const typesCount = {};
    occurrences.forEach(o => {
        const type = o.occurrenceType || 'Outros';
        typesCount[type] = (typesCount[type] || 0) + 1;
    });
    
    // Ordena e pega Top 5
    const sortedTypes = Object.entries(typesCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const ctxTypes = document.getElementById('dash-chart-types').getContext('2d');
    if (chartTypes) chartTypes.destroy();

    chartTypes = new Chart(ctxTypes, {
        type: 'doughnut',
        data: {
            labels: sortedTypes.map(i => i[0]),
            datasets: [{
                data: sortedTypes.map(i => i[1]),
                backgroundColor: ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'right' }
            }
        }
    });

    // Gráfico 2: Status Busca Ativa
    const statusCount = { 'Em Andamento': 0, 'Concluído': 0 };
    absences.forEach(a => {
        if (a.actionType === 'analise') statusCount['Concluído']++;
        else statusCount['Em Andamento']++;
    });

    const ctxStatus = document.getElementById('dash-chart-status').getContext('2d');
    if (chartStatus) chartStatus.destroy();

    chartStatus = new Chart(ctxStatus, {
        type: 'bar',
        data: {
            labels: Object.keys(statusCount),
            datasets: [{
                label: 'Ações',
                data: Object.values(statusCount),
                backgroundColor: ['#f59e0b', '#10b981'],
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            },
            plugins: { legend: { display: false } }
        }
    });
};
