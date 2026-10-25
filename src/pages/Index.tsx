import { Navigate } from 'react-router-dom';
import { menuBase } from '@/lib/venues';

// [FIX] Redirect root to menu instead of showing placeholder
const Index = () => <Navigate to={menuBase()} replace />;

export default Index;
