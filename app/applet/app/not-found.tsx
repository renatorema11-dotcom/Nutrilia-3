import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h2 className="text-2xl font-bold">Página não encontrada</h2>
      <Link href="/" className="mt-4 text-teal-600 hover:underline">
        Voltar para a página inicial
      </Link>
    </div>
  );
}
