import { Navigate } from 'react-router-dom';
import { menuPath } from '@/lib/venues';

// [FIX] Redirect root to menu instead of showing placeholder
const Index = () => <Navigate to={menuPath()} replace />;

export default Index;
