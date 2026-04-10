import React, { useMemo } from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Filler,
    Legend,
    ScriptableContext
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Chart.js のプラグイン登録
ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Filler,
    Legend
);

interface ElevationChartProps {
    profile: { distance: number; elevation: number; coords: number[] }[];
    onHoverPoint: (coords: number[] | null) => void;
}

const ElevationChart: React.FC<ElevationChartProps> = ({ profile, onHoverPoint }) => {
    const data = useMemo(() => ({
        labels: profile.map(p => p.distance.toFixed(2)),
        datasets: [
            {
                fill: true,
                label: '標高 (m)',
                data: profile.map(p => p.elevation),
                borderColor: 'rgb(53, 162, 235)',
                backgroundColor: (context: ScriptableContext<'line'>) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 150);
                    gradient.addColorStop(0, 'rgba(53, 162, 235, 0.5)');
                    gradient.addColorStop(1, 'rgba(53, 162, 235, 0)');
                    return gradient;
                },
                borderWidth: 2,
                pointRadius: 0, // 通常時は点を非表示
                pointHoverRadius: 6,
                tension: 0.3, // 線を滑らかに
            },
        ],
    }), [profile]);

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: {
                mode: 'index' as const,
                intersect: false,
                callbacks: {
                    label: (context: any) => `標高: ${context.parsed.y.toFixed(1)} m`,
                    title: (items: any) => `距離: ${items[0].label} km`
                }
            },
        },
        scales: {
            x: {
                display: true,
                title: { display: true, text: '距離 (km)' },
                ticks: { maxTicksLimit: 10 }
            },
            y: {
                display: true,
                title: { display: true, text: '標高 (m)' },
            },
        },
        // ホバー時の連動ロジック
        onHover: (event: any, elements: any[]) => {
            if (elements.length > 0) {
                const index = elements[0].index;
                onHoverPoint(profile[index].coords);
            } else {
                onHoverPoint(null);
            }
        },
    };

    if (profile.length === 0) return <div style={{ padding: 20 }}>地点を追加すると標高グラフが表示されます</div>;

    return (
        <div style={{ height: '200px', width: '100%', background: 'white', padding: '10px' }}>
            <Line options={options} data={data} />
        </div>
    );
};

export default React.memo(ElevationChart);