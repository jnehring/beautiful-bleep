// SPDX-License-Identifier: MIT
import type { Metadata } from "next";
import { blogPosts } from "@/lib/content";

export const metadata: Metadata = { title: "Blog — Beautiful Bleep", description: "News and articles about Beautiful Bleep." };

export default function BlogPage() {
  return (
    <>
      <h1>Blog</h1>
      <div className="grid">
        {blogPosts().map((p) => (
          <div className="card" key={p.slug}>
            <h3><a href={`/blog/${p.slug}/`}>{p.title}</a></h3>
            <p className="meta"><time dateTime={p.date}>{p.date}</time></p>
            <p>{p.description}</p>
          </div>
        ))}
      </div>
    </>
  );
}
