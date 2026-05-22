import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import InstructorChatWorkspace from '@/components/instructor/InstructorChatWorkspace'

type Props = {
  searchParams: Promise<{ fileId?: string; fileName?: string }>
}

export default async function InstructorChatPage({ searchParams }: Props) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'admin') {
    redirect('/admin')
  }

  const { fileId, fileName } = await searchParams

  // If a fileId was passed, look up the canonical file name from the DB
  // so we don't rely solely on the URL param.
  let resolvedFileName: string | undefined = fileName
  if (fileId) {
    const { data: fileRow } = await supabase
      .from('files')
      .select('original_name')
      .eq('file_id', fileId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (fileRow?.original_name) {
      resolvedFileName = fileRow.original_name
    }
  }

  return (
    <InstructorChatWorkspace
      userEmail={user.email}
      fileId={fileId}
      fileName={resolvedFileName}
    />
  )
}
