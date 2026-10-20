// SPDX-License-Identifier: MIT
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { blogPosts } from "@/lib/content";
import CopyCode from "../../docs/[...slug]/CopyCode";

export const dynamicParams = false;

export function generateStaticParams() {
  return blogPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = blogPosts().find((p) => p.slug === slug);
  return post ? { title: `${post.title} — Beautiful Bleep`, description: post.description } : {};
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = blogPosts().find((p) => p.slug === slug);
  if (!post) notFound();
  return (
    <>
      <p className="meta"><a href="/blog/">Blog</a> · <time dateTime={post.date}>{post.date}</time></p>
      <article className="post">
        <h1>{post.title}</h1>
        <div dangerouslySetInnerHTML={{ __html: post.html }} />
      </article>
      <CopyCode />
    </>
  );
}
