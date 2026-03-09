import { ProtectedRoute } from '@/components/auth/protected-route'
import { PermissionRequired } from '@/components/auth/permission-guard'
import { Permission } from '@/lib/permissions'
import CompanyRegistrationForm from '@/components/companies/company-registration-form'

export default function RegisterCompanyPage() {
  return (
    <ProtectedRoute>
      <PermissionRequired permission={Permission.COMPANY_CREATE}>
        <div className="container mx-auto py-8">
          <CompanyRegistrationForm />
        </div>
      </PermissionRequired>
    </ProtectedRoute>
  )
}