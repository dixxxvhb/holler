Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class CredR {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string t, int type, int f, out IntPtr c);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr c);
  public static string Get(string t) { IntPtr p; if (!CredRead(t, 1, 0, out p)) return null;
    var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    byte[] b = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, b, 0, b.Length); CredFree(p);
    var s = System.Text.Encoding.UTF8.GetString(b); if (s.Length > 0 && s.IndexOf('\0') >= 0) s = System.Text.Encoding.Unicode.GetString(b); return s; }
}
"@
$tok = [CredR]::Get('Supabase CLI:supabase')
if ($tok.StartsWith('go-keyring-base64:')) { $tok = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tok.Substring(18))) }
[Console]::Out.Write($tok)
