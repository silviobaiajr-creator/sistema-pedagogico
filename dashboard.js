
// =================================================================================
// ARQUIVO: dashboard.js
// VERSÃO: 1.0 (Dashboard Inicial)

import { getDashboardStats } from './firestore.js';
import { dom } from './state.js';

let chartTypes = null;
let chartStatus = null;

export const initDashboard = async () => {
    // Mostra loading nos cards
    document.getElementById('dash-total-students').innerHTML = '<i class="fas fa-spinner fa-spin text-sm"></i>';
    document.getElementById('dash-total-occurrences').innerHTML = '<i class="fas fa-spinner fa-spin text-sm"></i>';
    document.getElementById('dash-active-absences').innerHTML = '<i class="fas fa-spinner fa-spin text-sm"></i>';

    const stats = await getDashboardStats();

    if (!stats) {
        document.getElementById('dash-total-students').textContent = 'Erro';
        return;
    }

    // 1. Atualiza Cards
    // Efeito de contagem animada
    animateValue('dash-total-students', 0, stats.totalStudents, 1000);
    animateValue('dash-total-occurrences', 0, stats.totalOccurrences, 1000);
    animateValue('dash-active-absences', 0, stats.totalAbsences, 1000);

    // 2. Prepara Dados para Gráficos
    renderCharts(stats.chartDataOccurrences, stats.chartDataAbsences);
};

const animateValue = (id, start, end, duration) => {
    const obj = document.getElementById(id);
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
