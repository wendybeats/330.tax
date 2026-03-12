import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const taxYear = formData.get("tax_year") as string;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Validate file size (10MB max)
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File too large. Maximum 10MB." },
      { status: 400 }
    );
  }

  // Validate file type
  const allowedTypes = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "text/csv",
    "message/rfc822", // .eml
  ];

  if (!allowedTypes.includes(file.type) && !file.name.endsWith(".eml")) {
    return NextResponse.json(
      { error: "Unsupported file type. Accepted: PDF, PNG, JPG, CSV, EML" },
      { status: 400 }
    );
  }

  try {
    // Upload to Supabase Storage
    const filePath = `${user.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(filePath, file);

    if (uploadError) {
      return NextResponse.json(
        { error: "Failed to upload file", details: uploadError.message },
        { status: 500 }
      );
    }

    // Extract text content based on file type
    let content = "";
    const isImage = file.type.startsWith("image/");

    if (file.type === "text/csv" || file.type === "message/rfc822") {
      content = await file.text();
    } else if (file.type === "application/pdf") {
      // For PDFs, we'll send the raw text to Claude
      // In production, use a PDF parser. For now, send as base64 for Claude's analysis
      const buffer = await file.arrayBuffer();
      content = `[PDF Document - ${file.name}]\nBase64: ${Buffer.from(buffer).toString("base64").slice(0, 50000)}`;
    } else if (isImage) {
      // Images will be sent to Claude with vision
      const buffer = await file.arrayBuffer();
      content = `[Image - ${file.name}]\nBase64: ${Buffer.from(buffer).toString("base64")}`;
    }

    // Create raw source record
    const { data: source, error: sourceError } = await supabase
      .from("raw_sources")
      .insert({
        user_id: user.id,
        source_type: "file_upload",
        file_path: filePath,
        raw_content: content.slice(0, 100000), // Limit stored content
      })
      .select()
      .single();

    if (sourceError) {
      return NextResponse.json(
        { error: "Failed to create source record" },
        { status: 500 }
      );
    }

    // Parse with Claude API
    const parseResponse = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/ai/parse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_id: source.id,
          content,
          source_type: "document",
          tax_year: taxYear ? parseInt(taxYear) : undefined,
          is_image: isImage,
        }),
      }
    );

    let parseResult = null;
    if (parseResponse.ok) {
      parseResult = await parseResponse.json();
    }

    return NextResponse.json({
      source_id: source.id,
      file_path: filePath,
      parsed: parseResult,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to process uploaded file" },
      { status: 500 }
    );
  }
}
