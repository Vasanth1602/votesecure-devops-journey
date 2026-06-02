import { Cell, Legend, Pie, PieChart as RePieChart, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#0ea5e9', '#ef4444', '#9333ea'];

export default function PieChart({ data }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-lg font-semibold">Vote Share</h3>
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <RePieChart>
            <Pie data={data} dataKey="vote_count" nameKey="name" outerRadius={100} label>
              {data.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend formatter={(value, _entry, index) => `${value} (${data[index]?.vote_count || 0})`} />
          </RePieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
