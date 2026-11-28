import { useState } from "react";
import { ChevronDown, ChevronLeft, FileText, Network } from "lucide-react";
import type { Citation } from "./api";
import "./mind-map.css";

export type StudyGraph = {
  nodes: {
    id: string;
    kind: "root" | "source" | "passage";
    label: string;
    reference?: Citation;
  }[];
  edges: { from: string; to: string; relation: "contains" }[];
  relation_semantics: "source_containment_only";
};

export default function MindMap({
  graph,
  onCitation,
}: {
  graph: StudyGraph;
  onCitation: (reference: Citation) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const sources = graph.nodes.filter((n) => n.kind === "source");
  const active = graph.nodes.find((n) => n.id === selected);
  function toggle(id: string) {
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <section className="mind-map" aria-label="خريطة المصادر التفاعلية">
      <p className="field-hint">
        الخطوط تعني «يحتوي على» فقط: دفتر ← مصدر ← اقتباس. لا تمثل علاقات سببية
        أو استنتاجات بالذكاء الاصطناعي. اختر مقطعًا لقراءة نصه وفتح مرجعه.
      </p>
      <div className="map-actions">
        <button className="outline" onClick={() => setCollapsed(new Set())}>
          توسيع الكل
        </button>
        <button
          className="outline"
          onClick={() => setCollapsed(new Set(sources.map((n) => n.id)))}
        >
          طي الكل
        </button>
      </div>
      <div className="map-root">
        <Network size={22} />
        <strong>
          {graph.nodes.find((n) => n.kind === "root")?.label ||
            "المصادر المحددة"}
        </strong>
        <span>{sources.length} مصادر</span>
      </div>
      <ul className="map-branches">
        {sources.map((source, index) => {
          const ids = new Set(
            graph.edges.filter((e) => e.from === source.id).map((e) => e.to),
          );
          const children = graph.nodes.filter(
            (n) => n.kind === "passage" && ids.has(n.id),
          );
          const closed = collapsed.has(source.id);
          return (
            <li className="map-source" key={source.id}>
              <button
                className="map-source-toggle"
                aria-expanded={!closed}
                aria-controls={`map-source-${index}`}
                onClick={() => toggle(source.id)}
              >
                {closed ? <ChevronLeft size={18} /> : <ChevronDown size={18} />}
                <span>{source.label}</span>
                <small>{children.length} مقاطع</small>
              </button>
              <ul
                id={`map-source-${index}`}
                className="map-passages"
                hidden={closed}
              >
                {children.map((node, i) => (
                  <li key={node.id}>
                    <button
                      className="map-node"
                      aria-pressed={selected === node.id}
                      onClick={() => setSelected(node.id)}
                    >
                      <small>مقطع {i + 1}</small>
                      <span dir="auto">{node.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <div className="map-detail" aria-live="polite">
        {active?.reference ? (
          <>
            <h4>المقطع المحدد</h4>
            <blockquote dir="auto">{active.label}</blockquote>
            <button
              className="study-reference"
              onClick={() => onCitation(active.reference!)}
            >
              <FileText size={15} />
              فتح مرجع المقطع: {active.reference.title}
            </button>
          </>
        ) : (
          <p>اختر إحدى عقد المقاطع لعرض المرجع.</p>
        )}
      </div>
    </section>
  );
}
